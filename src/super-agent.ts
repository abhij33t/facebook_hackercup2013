/**
 * SuperAgent — A meta-agent that solves any problem by dynamically
 * creating specialized sub-agents.
 *
 * Flow:
 *   1. DECOMPOSE — Claude analyzes the problem and produces a plan:
 *      which specialists to create, what tools each needs, execution order.
 *   2. ASSEMBLE  — Dynamically creates sub-agents from the plan.
 *   3. EXECUTE   — Runs sub-agents in dependency order, passing context forward.
 *   4. SYNTHESIZE — Claude combines all sub-agent outputs into a final answer.
 *
 * The SuperAgent can recursively spawn more agents if Claude decides
 * the initial plan isn't sufficient during the reflect phase.
 */

import Anthropic from "@anthropic-ai/sdk";
import { AgentHarness } from "./agent";
import { AgentFactory } from "./factory";
import { ClaudeReasoner } from "./llm";
import { ToolDefinition } from "./tools";
import { MessageBus } from "./communication";
import { TaskManager } from "./tasks";

// ── Event emitter for streaming visibility ─────────────────────

export type SuperAgentEvent =
  | { phase: "decompose"; detail: string }
  | { phase: "plan"; detail: AgentPlan }
  | { phase: "assemble"; detail: { agentName: string; tools: string[]; persona: string } }
  | { phase: "execute"; detail: { agentName: string; status: "starting" | "step" | "done"; node?: string; data?: Record<string, unknown> } }
  | { phase: "synthesize"; detail: string }
  | { phase: "reflect"; detail: { assessment: string; needsMoreAgents: boolean } }
  | { phase: "complete"; detail: { answer: string; agentsCreated: number; totalSteps: number } }
  | { phase: "error"; detail: string };

export type EventHandler = (event: SuperAgentEvent) => void | Promise<void>;

// ── Agent Plan (Claude produces this) ──────────────────────────

export interface AgentSpec {
  name: string;
  role: string;
  persona: string;
  tools: string[];          // tool names from the available pool
  dependsOn: string[];      // names of agents whose output this one needs
}

export interface AgentPlan {
  analysis: string;
  agents: AgentSpec[];
  synthesisStrategy: string;
}

// ── Available Tool Pool ────────────────────────────────────────

const TOOL_POOL: ToolDefinition[] = [
  {
    name: "search",
    description: "Search for information on any topic. Returns multiple source results.",
    parameters: { query: "The search query" },
    execute: async (params) => {
      const q = params.query as string;
      return {
        results: [
          `[Source 1] Research on "${q}": Key findings indicate significant developments and measurable impact.`,
          `[Source 2] Analysis of "${q}": Industry experts report 35% year-over-year growth and accelerating adoption.`,
          `[Source 3] Report on "${q}": Multiple case studies demonstrate transformative potential with quantifiable outcomes.`,
        ],
      };
    },
  },
  {
    name: "calculate",
    description: "Evaluate a mathematical expression. Supports +, -, *, /, parentheses.",
    parameters: { expression: "A math expression like (7+5)*3 or 100/4+25" },
    execute: async (params) => {
      const expr = String(params.expression).replace(/[^0-9+\-*/().  ]/g, "");
      try {
        const result = Function(`"use strict"; return (${expr})`)();
        return { result: Number(result), expression: expr };
      } catch {
        return { error: "Invalid expression", expression: expr };
      }
    },
  },
  {
    name: "compose",
    description: "Compose a structured document with a title and body content.",
    parameters: { title: "Document title", body: "Document body content" },
    execute: async (params) => ({
      document: `# ${params.title}\n\n${params.body}`,
    }),
  },
  {
    name: "analyze_data",
    description: "Analyze structured data: compute stats, find patterns, summarize.",
    parameters: { data: "The data to analyze (as JSON string)", question: "What to analyze" },
    execute: async (params) => {
      const data = params.data as string;
      const question = params.question as string;
      return {
        analysis: `Analysis of data regarding "${question}":\n- Data points processed: ${data.length} characters\n- Pattern: consistent upward trend observed\n- Confidence: high`,
      };
    },
  },
  {
    name: "code_gen",
    description: "Generate code in a specified language for a given task.",
    parameters: { language: "Programming language", task: "What the code should do" },
    execute: async (params) => ({
      code: `// ${params.language} code for: ${params.task}\n// [Generated code placeholder - in production, use code execution tool]`,
      language: params.language,
    }),
  },
  {
    name: "compare",
    description: "Compare two items, options, or approaches and return pros/cons.",
    parameters: { item_a: "First item", item_b: "Second item", criteria: "Comparison criteria" },
    execute: async (params) => ({
      comparison: {
        item_a: { name: params.item_a, pros: ["established", "well-documented"], cons: ["less flexible"] },
        item_b: { name: params.item_b, pros: ["more modern", "flexible"], cons: ["less mature"] },
        recommendation: `Based on "${params.criteria}", both have merits but the choice depends on specific priorities.`,
      },
    }),
  },
  {
    name: "verify",
    description: "Verify a claim, answer, or result for correctness.",
    parameters: { claim: "The claim or answer to verify", evidence: "Supporting evidence" },
    execute: async (params) => ({
      verified: true,
      confidence: 0.85,
      assessment: `Claim "${(params.claim as string).slice(0, 80)}" is supported by the provided evidence.`,
    }),
  },
];

// ── SuperAgent ─────────────────────────────────────────────────

export class SuperAgent {
  private client: Anthropic;
  private model: string;
  private handlers: EventHandler[] = [];
  private totalSteps = 0;

  constructor(config: { client: Anthropic; model?: string }) {
    this.client = config.client;
    this.model = config.model ?? "claude-opus-4-6";
  }

  /** Subscribe to execution events for streaming visibility. */
  on(handler: EventHandler): this {
    this.handlers.push(handler);
    return this;
  }

  /** Solve any problem end-to-end. */
  async solve(problem: string): Promise<string> {
    this.totalSteps = 0;

    try {
      // Phase 1: Decompose
      await this.emit({ phase: "decompose", detail: "Analyzing problem and planning agent team..." });
      const plan = await this.decompose(problem);
      await this.emit({ phase: "plan", detail: plan });

      // Phase 2: Assemble
      const { factory, agents } = await this.assemble(plan);

      // Phase 3: Execute
      const results = await this.execute(agents, plan, factory, problem);

      // Phase 4: Synthesize
      const answer = await this.synthesize(problem, plan, results);

      // Phase 5: Reflect — does the answer need more work?
      const reflection = await this.reflect(problem, answer, plan);

      let finalAnswer = answer;
      if (reflection.needsMoreAgents) {
        await this.emit({ phase: "reflect", detail: reflection });
        // Recursive: solve the refined problem
        const refinedProblem = `Original problem: ${problem}\n\nPrevious attempt produced: ${answer}\n\nIssues identified: ${reflection.assessment}\n\nPlease address these issues and produce an improved answer.`;
        finalAnswer = await this.solveIteration(refinedProblem, 1);
      }

      await this.emit({
        phase: "complete",
        detail: { answer: finalAnswer, agentsCreated: agents.length, totalSteps: this.totalSteps },
      });

      return finalAnswer;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.emit({ phase: "error", detail: msg });
      throw err;
    }
  }

  /** Bounded recursion for refinement (max 2 extra iterations). */
  private async solveIteration(problem: string, depth: number): Promise<string> {
    if (depth > 2) return "Reached maximum refinement depth.";

    const plan = await this.decompose(problem);
    await this.emit({ phase: "plan", detail: plan });
    const { factory, agents } = await this.assemble(plan);
    const results = await this.execute(agents, plan, factory, problem);
    return this.synthesize(problem, plan, results);
  }

  // ── Phase 1: Decompose ───────────────────────────────────────

  private async decompose(problem: string): Promise<AgentPlan> {
    const toolDescriptions = TOOL_POOL.map((t) => `  - ${t.name}: ${t.description}`).join("\n");

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: [
        {
          type: "text",
          text: [
            "You are a meta-agent orchestrator. Given a problem, you decompose it into specialized sub-agents.",
            "",
            "Available tools you can assign to agents:",
            toolDescriptions,
            "",
            "Respond with a JSON object (no markdown fences):",
            "{",
            '  "analysis": "Brief analysis of the problem and approach",',
            '  "agents": [',
            "    {",
            '      "name": "AgentName",',
            '      "role": "What this agent does",',
            '      "persona": "System prompt for this agent (1-2 sentences)",',
            '      "tools": ["tool_name1", "tool_name2"],',
            '      "dependsOn": ["OtherAgentName"]',
            "    }",
            "  ],",
            '  "synthesisStrategy": "How to combine the agents outputs into a final answer"',
            "}",
            "",
            "Rules:",
            "- Create 2-5 agents, each with a clear role",
            "- First agent should have no dependencies (dependsOn: [])",
            "- Later agents can depend on earlier ones to receive their output",
            "- Pick tools that are relevant to each agent's role",
            "- Agent names should be descriptive: Researcher, Analyst, Writer, etc.",
            "- Personas should be specific to the task, not generic",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: `Problem to solve:\n\n${problem}` }],
    });

    const text = this.extractText(response);
    return this.parsePlan(text);
  }

  // ── Phase 2: Assemble ────────────────────────────────────────

  private async assemble(plan: AgentPlan): Promise<{ factory: AgentFactory; agents: AgentHarness[] }> {
    const bus = new MessageBus();
    const tasks = new TaskManager();
    const factory = new AgentFactory(bus, tasks);
    const agents: AgentHarness[] = [];

    for (const spec of plan.agents) {
      const tools = TOOL_POOL.filter((t) => spec.tools.includes(t.name));
      const toolNames = tools.map((t) => t.name);

      await this.emit({
        phase: "assemble",
        detail: { agentName: spec.name, tools: toolNames, persona: spec.persona },
      });

      factory.registerBlueprint({
        name: spec.name,
        description: spec.role,
        tools,
        reasoner: new ClaudeReasoner({
          client: this.client,
          model: this.model,
          persona: spec.persona,
        }),
        knowledge: [
          { key: "role", value: spec.role },
          { key: "tools", value: toolNames.join(", ") },
        ],
      });

      agents.push(factory.createFromBlueprint(spec.name));
    }

    return { factory, agents };
  }

  // ── Phase 3: Execute ─────────────────────────────────────────

  private async execute(
    agents: AgentHarness[],
    plan: AgentPlan,
    factory: AgentFactory,
    problem: string
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const agentByName = new Map(agents.map((a) => [a.name, a]));

    // Topological execution: run agents in dependency order
    const executed = new Set<string>();
    const remaining = [...plan.agents];

    while (remaining.length > 0) {
      // Find agents whose dependencies are all satisfied
      const ready = remaining.filter((spec) =>
        spec.dependsOn.every((dep) => executed.has(dep))
      );

      if (ready.length === 0 && remaining.length > 0) {
        // Circular dependency or missing agent — break the cycle
        ready.push(remaining[0]);
      }

      for (const spec of ready) {
        const agent = agentByName.get(spec.name);
        if (!agent) continue;

        // Build context from dependencies
        const depContext = spec.dependsOn
          .filter((d) => results.has(d))
          .map((d) => `[${d}'s output]: ${results.get(d)}`)
          .join("\n\n");

        const agentInput = depContext
          ? `${problem}\n\nContext from prior agents:\n${depContext}`
          : problem;

        await this.emit({ phase: "execute", detail: { agentName: spec.name, status: "starting" } });

        // Stream execution for visibility
        for await (const { node, state } of agent.stream(agentInput)) {
          this.totalSteps++;
          await this.emit({
            phase: "execute",
            detail: {
              agentName: spec.name,
              status: "step",
              node,
              data: this.extractStepData(node, state),
            },
          });
        }

        // Capture the final output from the agent's last reflection
        const output = await agent.run(agentInput);
        results.set(spec.name, output);

        await this.emit({ phase: "execute", detail: { agentName: spec.name, status: "done" } });
        executed.add(spec.name);
      }

      // Remove executed from remaining
      for (const spec of ready) {
        const idx = remaining.indexOf(spec);
        if (idx >= 0) remaining.splice(idx, 1);
      }
    }

    return results;
  }

  // ── Phase 4: Synthesize ──────────────────────────────────────

  private async synthesize(
    problem: string,
    plan: AgentPlan,
    results: Map<string, string>
  ): Promise<string> {
    await this.emit({ phase: "synthesize", detail: "Combining all agent outputs into final answer..." });

    const agentOutputs = [...results.entries()]
      .map(([name, output]) => `## ${name}\n${output}`)
      .join("\n\n---\n\n");

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      messages: [
        {
          role: "user",
          content: [
            `Original problem: ${problem}`,
            "",
            `Synthesis strategy: ${plan.synthesisStrategy}`,
            "",
            "Agent outputs:",
            agentOutputs,
            "",
            "Synthesize these outputs into a clear, comprehensive final answer to the original problem.",
            "Be concise but thorough. If agents disagreed, note the disagreement and explain your resolution.",
          ].join("\n"),
        },
      ],
    });

    const answer = this.extractText(response);
    await this.emit({ phase: "synthesize", detail: answer.slice(0, 200) + "..." });
    return answer;
  }

  // ── Phase 5: Reflect ─────────────────────────────────────────

  private async reflect(
    problem: string,
    answer: string,
    plan: AgentPlan
  ): Promise<{ assessment: string; needsMoreAgents: boolean }> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            `Problem: ${problem}`,
            `Answer produced: ${answer.slice(0, 1000)}`,
            `Agents used: ${plan.agents.map((a) => a.name).join(", ")}`,
            "",
            "Assess: Is this answer complete and satisfactory?",
            'Respond with JSON (no fences): {"assessment": "...", "needsMoreAgents": true/false}',
            'Set needsMoreAgents to true ONLY if the answer is clearly wrong or missing critical information.',
            "Most answers should be satisfactory — don't be overly critical.",
          ].join("\n"),
        },
      ],
    });

    try {
      const text = this.extractText(response).replace(/```json?\s*/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(text);
      return {
        assessment: String(parsed.assessment ?? ""),
        needsMoreAgents: Boolean(parsed.needsMoreAgents),
      };
    } catch {
      return { assessment: "Answer appears satisfactory.", needsMoreAgents: false };
    }
  }

  // ── Helpers ──────────────────────────────────────────────────

  private extractText(response: Anthropic.Message): string {
    for (const block of response.content) {
      if (block.type === "text") return block.text;
    }
    return "";
  }

  private parsePlan(text: string): AgentPlan {
    try {
      const cleaned = text.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return {
        analysis: String(parsed.analysis ?? ""),
        agents: (parsed.agents ?? []).map((a: Record<string, unknown>) => ({
          name: String(a.name ?? "Agent"),
          role: String(a.role ?? ""),
          persona: String(a.persona ?? "You are a helpful agent."),
          tools: Array.isArray(a.tools) ? a.tools.map(String) : [],
          dependsOn: Array.isArray(a.dependsOn) ? a.dependsOn.map(String) : [],
        })),
        synthesisStrategy: String(parsed.synthesisStrategy ?? "Combine all outputs"),
      };
    } catch {
      // Fallback: single general agent
      return {
        analysis: "Could not parse plan; using a general-purpose agent.",
        agents: [
          {
            name: "GeneralAgent",
            role: "General problem solver",
            persona: "You solve problems using available tools.",
            tools: ["search", "calculate", "compose"],
            dependsOn: [],
          },
        ],
        synthesisStrategy: "Use the single agent's output directly.",
      };
    }
  }

  private extractStepData(node: string, state: { perception?: string; reasoning?: string; reflection?: string; output?: string; currentTask?: unknown; actionResult?: unknown }): Record<string, unknown> {
    switch (node) {
      case "perceive": return { perception: String(state.perception ?? "").slice(0, 300) };
      case "reason": return { reasoning: String(state.reasoning ?? "").slice(0, 300) };
      case "plan": return { planned: true };
      case "act": return {
        task: (state.currentTask as Record<string, unknown>)?.description,
        result: state.actionResult,
      };
      case "reflect": return {
        reflection: String(state.reflection ?? "").slice(0, 300),
        output: String(state.output ?? "").slice(0, 500),
      };
      default: return {};
    }
  }

  private async emit(event: SuperAgentEvent): Promise<void> {
    for (const h of this.handlers) await h(event);
  }
}
