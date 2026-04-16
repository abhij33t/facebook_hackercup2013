/**
 * ClaudeReasoner — LLM-backed Reasoner using the Anthropic SDK.
 *
 * Plugs a real Claude model into the AgentHarness. Each method
 * (reason, plan, reflect) is a structured Claude API call.
 *
 * Usage:
 *   import Anthropic from "@anthropic-ai/sdk";
 *   const client = new Anthropic();  // uses ANTHROPIC_API_KEY
 *   const reasoner = new ClaudeReasoner(client);
 *   const agent = new AgentHarness({ reasoner, ... });
 */

import Anthropic from "@anthropic-ai/sdk";
import { Reasoner, ReasonerContext } from "./agent";
import { TaskCreate } from "./tasks";
import { ToolResult } from "./tools";

export interface ClaudeReasonerConfig {
  client: Anthropic;
  model?: string;
  /** Extra system prompt prepended to all calls. */
  persona?: string;
}

export class ClaudeReasoner implements Reasoner {
  private client: Anthropic;
  private model: string;
  private persona: string;

  constructor(config: ClaudeReasonerConfig) {
    this.client = config.client;
    this.model = config.model ?? "claude-opus-4-6";
    this.persona = config.persona ?? "You are a helpful, precise AI agent.";
  }

  async reason(context: ReasonerContext): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: this.persona,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: this.buildReasonPrompt(context),
        },
      ],
    });

    return this.extractText(response);
  }

  async plan(goal: string, context: ReasonerContext): Promise<TaskCreate[]> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: [
        {
          type: "text",
          text: [
            this.persona,
            "",
            "When planning, output a JSON array of tasks. Each task is an object with:",
            '  - "description": what to do',
            '  - "priority": "critical" | "high" | "medium" | "low"',
            '  - "metadata": optional object with "tool" (tool name) and "toolParams" (parameters)',
            "",
            "Output ONLY the JSON array, no markdown fences, no explanation.",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            `Goal: ${goal}`,
            "",
            `Available tools: ${context.availableTools.join(", ") || "none"}`,
            "",
            context.memory.relevantFacts.length > 0
              ? `Known facts:\n${context.memory.relevantFacts.join("\n")}`
              : "",
            "",
            "Produce a JSON array of tasks to accomplish this goal.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    });

    const text = this.extractText(response);
    return this.parsePlan(text);
  }

  async reflect(
    result: ToolResult | null,
    context: ReasonerContext
  ): Promise<{ reflection: string; route: "act" | "escalate" | "done" }> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: [
            this.persona,
            "",
            "You are reflecting on the outcome of an action.",
            "Respond with a JSON object:",
            '{  "reflection": "your assessment of what happened",',
            '   "route": "done" | "act" | "escalate"  }',
            "",
            'Use "done" if the task is complete.',
            'Use "act" if there are more tasks to work on.',
            'Use "escalate" if you need human help.',
            "",
            "Output ONLY the JSON object, no markdown fences.",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: this.buildReflectPrompt(result, context),
        },
      ],
    });

    const text = this.extractText(response);
    return this.parseReflection(text, context);
  }

  // ── Prompt builders ──────────────────────────────────────────

  private buildReasonPrompt(context: ReasonerContext): string {
    const parts = [`Input: ${context.input}`, `Perception: ${context.perception}`];

    if (context.memory.relevantEpisodes.length > 0) {
      parts.push(
        "Past experiences:",
        ...context.memory.relevantEpisodes.map(
          (ep) => `  - Situation: "${ep.situation}" → Action: "${ep.action}" → Outcome: "${ep.outcome}" (reward: ${ep.reward})`
        )
      );
    }
    if (context.memory.relevantFacts.length > 0) {
      parts.push("Known facts:", ...context.memory.relevantFacts.map((f) => `  - ${f}`));
    }
    if (context.availableTools.length > 0) {
      parts.push(`Available tools: ${context.availableTools.join(", ")}`);
    }

    parts.push("", "Analyze this situation. What should be done and why? Be concise.");
    return parts.join("\n");
  }

  private buildReflectPrompt(result: ToolResult | null, context: ReasonerContext): string {
    const parts = [`Original input: ${context.input}`];

    if (result) {
      parts.push(
        `Action taken: ${result.tool}`,
        `Success: ${result.success}`,
        `Output: ${JSON.stringify(result.output).slice(0, 500)}`,
        result.error ? `Error: ${result.error}` : ""
      );
    } else {
      parts.push("No action was taken (no tasks available).");
    }

    const stats = context.taskStats;
    parts.push(
      "",
      `Task stats: ${stats.pending ?? 0} pending, ${stats.completed ?? 0} completed, ${stats.failed ?? 0} failed`
    );

    return parts.filter(Boolean).join("\n");
  }

  // ── Response parsers ─────────────────────────────────────────

  private extractText(response: Anthropic.Message): string {
    for (const block of response.content) {
      if (block.type === "text") return block.text;
    }
    return "";
  }

  private parsePlan(text: string): TaskCreate[] {
    try {
      // Strip markdown fences if present
      const cleaned = text.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return [{ description: text, priority: "medium" }];
      return parsed.map((item: Record<string, unknown>) => ({
        description: String(item.description ?? item.task ?? "unknown task"),
        priority: this.validatePriority(String(item.priority ?? "medium")),
        metadata: (item.metadata as Record<string, unknown>) ?? {},
      }));
    } catch {
      // If parsing fails, treat the whole text as a single task
      return [{ description: text.slice(0, 200), priority: "medium" }];
    }
  }

  private parseReflection(
    text: string,
    context: ReasonerContext
  ): { reflection: string; route: "act" | "escalate" | "done" } {
    try {
      const cleaned = text.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);
      const route = this.validateRoute(String(parsed.route ?? "done"));
      // If no pending tasks left, always route to done
      const pending = (context.taskStats.pending ?? 0) as number;
      return {
        reflection: String(parsed.reflection ?? text),
        route: pending === 0 ? "done" : route,
      };
    } catch {
      return { reflection: text, route: "done" };
    }
  }

  private validatePriority(p: string): "critical" | "high" | "medium" | "low" {
    if (["critical", "high", "medium", "low"].includes(p)) return p as "critical" | "high" | "medium" | "low";
    return "medium";
  }

  private validateRoute(r: string): "act" | "escalate" | "done" {
    if (["act", "escalate", "done"].includes(r)) return r as "act" | "escalate" | "done";
    return "done";
  }
}
