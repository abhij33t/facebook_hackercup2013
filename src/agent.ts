/**
 * Layer 6: AgentHarness
 *
 * The core agent loop modeled as a SimpleGraph:
 *
 *   START → perceive → reason → plan → act → reflect → route
 *                                                        ↓
 *                              (more tasks?) → act ──────┘
 *                              (need help?)  → escalate → route
 *                              (done?)       → END
 *
 * This mirrors how humans work:
 *   1. Perceive — gather input, read messages, check context
 *   2. Reason  — think about what's going on (LLM call goes here)
 *   3. Plan    — break the problem into tasks
 *   4. Act     — execute the next task (use tools, call sub-agents)
 *   5. Reflect — evaluate the outcome, learn from it
 *   6. Route   — decide what to do next
 *
 * Scaling property: plug in a better reasoner (LLM) → smarter agent.
 * Plug in more tools → more capable agent. Same architecture, any scale.
 */

import { SimpleGraph } from "./graph";
import { START, END } from "./types";
import { Memory, Episode } from "./memory";
import { ToolRegistry, ToolResult } from "./tools";
import { MessageBus, Message } from "./communication";
import { TaskManager, Task, TaskCreate } from "./tasks";

// ── Agent State (flows through the graph) ──────────────────────────

export interface AgentState {
  agentId: string;
  input: string;
  perception: string;
  reasoning: string;
  plan: TaskCreate[];
  currentTask: Task | null;
  actionResult: ToolResult | null;
  reflection: string;
  output: string;
  route: "act" | "escalate" | "done";
  turnCount: number;
}

// ── Pluggable Reasoner Interface ───────────────────────────────────
// Bring your own LLM — or use a simple rule-based one for testing.

export interface Reasoner {
  /** Given the full agent context, produce a reasoning string. */
  reason(context: ReasonerContext): Promise<string>;
  /** Given a goal, produce a list of sub-tasks. */
  plan(goal: string, context: ReasonerContext): Promise<TaskCreate[]>;
  /** Given an action result, produce a reflection and next route. */
  reflect(result: ToolResult | null, context: ReasonerContext): Promise<{ reflection: string; route: "act" | "escalate" | "done" }>;
}

export interface ReasonerContext {
  input: string;
  perception: string;
  memory: {
    working: Record<string, unknown>;
    relevantEpisodes: Episode[];
    relevantFacts: string[];
  };
  availableTools: string[];
  taskStats: Record<string, number>;
  messageHistory: Message[];
}

// ── Agent Configuration ────────────────────────────────────────────

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  reasoner: Reasoner;
  tools?: ToolRegistry;
  memory?: Memory;
  bus?: MessageBus;
  tasks?: TaskManager;
}

// ── The Agent Harness ──────────────────────────────────────────────

export class AgentHarness {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly reasoner: Reasoner;
  readonly tools: ToolRegistry;
  readonly memory: Memory;
  readonly bus: MessageBus;
  readonly tasks: TaskManager;

  private graph: ReturnType<SimpleGraph<AgentState>["compile"]>;

  constructor(config: AgentConfig) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;
    this.reasoner = config.reasoner;
    this.tools = config.tools ?? new ToolRegistry();
    this.memory = config.memory ?? new Memory();
    this.bus = config.bus ?? new MessageBus();
    this.tasks = config.tasks ?? new TaskManager();

    this.graph = this.buildGraph();
  }

  /** Run the agent on an input string. Returns the final output. */
  async run(input: string): Promise<string> {
    const initial: AgentState = {
      agentId: this.id,
      input,
      perception: "",
      reasoning: "",
      plan: [],
      currentTask: null,
      actionResult: null,
      reflection: "",
      output: "",
      route: "done",
      turnCount: 0,
    };

    const final = await this.graph.invoke(initial);
    return final.output;
  }

  /** Stream the agent's execution, yielding after each graph node. */
  async *stream(input: string): AsyncGenerator<{ node: string; state: AgentState }> {
    const initial: AgentState = {
      agentId: this.id,
      input,
      perception: "",
      reasoning: "",
      plan: [],
      currentTask: null,
      actionResult: null,
      reflection: "",
      output: "",
      route: "done",
      turnCount: 0,
    };

    yield* this.graph.stream(initial);
  }

  /** Send a message to this agent via the bus. */
  async handleMessage(msg: Message): Promise<void> {
    const output = await this.run(msg.payload as string);
    await this.bus.reply(msg, output, this.id);
  }

  // ── Build the internal graph ───────────────────────────────────

  private buildGraph() {
    const g = new SimpleGraph<AgentState>();
    const self = this;

    // ── Node: Perceive ─────────────────────────────────────────
    g.addNode("perceive", async (state) => {
      // Gather context: recent messages, relevant memories
      const messages = self.bus.history(undefined, 10);
      const episodes = self.memory.episodic.recall(state.input, [], 3);
      const facts = self.memory.semantic.search(state.input, 5);

      // Store in working memory for the reasoner
      self.memory.working.set("current_input", state.input);
      self.memory.working.set("recent_messages", messages);
      self.memory.working.set("relevant_episodes", episodes);

      const perception = [
        `Input: ${state.input}`,
        episodes.length > 0 ? `Recalled ${episodes.length} relevant past experiences.` : "No prior experience with this.",
        facts.length > 0 ? `Known facts: ${facts.map((f) => f.key).join(", ")}` : "",
        messages.length > 0 ? `${messages.length} recent messages on the bus.` : "",
      ].filter(Boolean).join(" ");

      return { ...state, perception };
    });

    // ── Node: Reason ───────────────────────────────────────────
    g.addNode("reason", async (state) => {
      const context = self.buildReasonerContext(state);
      const reasoning = await self.reasoner.reason(context);
      return { ...state, reasoning };
    });

    // ── Node: Plan ─────────────────────────────────────────────
    g.addNode("plan", async (state) => {
      // If this agent already has assigned tasks or available work, skip planning
      const assigned = self.tasks.list({ status: "pending", assignee: self.id });
      if (assigned.length > 0) {
        return { ...state, plan: [] };
      }
      const available = self.tasks.next(self.id);
      if (available) {
        return { ...state, plan: [] };
      }

      // No pre-assigned work — ask the reasoner to create a plan
      const context = self.buildReasonerContext(state);
      const plan = await self.reasoner.plan(state.input, context);

      // Register tasks assigned to this agent
      for (const tc of plan) {
        self.tasks.add({ ...tc, assignee: self.id });
      }

      return { ...state, plan };
    });

    // ── Node: Act ──────────────────────────────────────────────
    g.addNode("act", async (state) => {
      const task = self.tasks.next(self.id);
      if (!task) {
        return { ...state, currentTask: null, actionResult: null };
      }

      self.tasks.start(task.id, self.id);
      let actionResult: ToolResult;

      // If the task references a tool, execute it
      const toolName = task.metadata["tool"] as string | undefined;
      if (toolName && self.tools.has(toolName)) {
        const params = (task.metadata["toolParams"] ?? {}) as Record<string, unknown>;
        actionResult = await self.tools.execute(toolName, params);
      } else {
        // Default: the "reasoning" itself is the action
        actionResult = {
          tool: "reason",
          success: true,
          output: state.reasoning,
          durationMs: 0,
        };
      }

      if (actionResult.success) {
        self.tasks.complete(task.id, actionResult.output);
        // Broadcast the result so other agents can use it
        await self.bus.send({
          from: self.id,
          to: "all",
          type: "broadcast",
          channel: "results",
          payload: { taskId: task.id, taskDescription: task.description, result: actionResult.output },
        });
      } else {
        self.tasks.fail(task.id, actionResult.error ?? "Unknown error");
      }

      return { ...state, currentTask: task, actionResult, turnCount: state.turnCount + 1 };
    });

    // ── Node: Reflect ──────────────────────────────────────────
    g.addNode("reflect", async (state) => {
      const context = self.buildReasonerContext(state);
      const { reflection, route } = await self.reasoner.reflect(state.actionResult, context);

      // Learn from this experience
      if (state.currentTask && state.actionResult) {
        self.memory.episodic.record({
          situation: state.input,
          action: state.currentTask.description,
          outcome: String(state.actionResult.output),
          reward: state.actionResult.success ? 0.8 : -0.5,
          tags: [state.currentTask.priority, state.actionResult.tool],
        });
      }

      const output = route === "done" ? reflection : state.output;
      return { ...state, reflection, route, output };
    });

    // ── Node: Escalate ─────────────────────────────────────────
    g.addNode("escalate", async (state) => {
      await self.bus.send({
        from: self.id,
        to: "human",
        type: "broadcast",
        channel: "escalation",
        payload: { reason: state.reflection, context: state.input },
      });
      return { ...state, output: `[Escalated] ${state.reflection}` };
    });

    // ── Wire edges ─────────────────────────────────────────────
    g.addEdge(START, "perceive");
    g.addEdge("perceive", "reason");
    g.addEdge("reason", "plan");
    g.addEdge("plan", "act");
    g.addEdge("act", "reflect");

    // Conditional routing after reflect
    g.addConditionalEdge("reflect", (state) => {
      if (state.route === "act") return "act";
      if (state.route === "escalate") return "escalate";
      return END;
    });

    g.addEdge("escalate", END);

    return g.compile();
  }

  private buildReasonerContext(state: AgentState): ReasonerContext {
    return {
      input: state.input,
      perception: state.perception,
      memory: {
        working: this.memory.working.snapshot(),
        relevantEpisodes: this.memory.episodic.recall(state.input, [], 3),
        relevantFacts: this.memory.semantic.search(state.input, 5).map((f) => `${f.key}: ${f.value}`),
      },
      availableTools: this.tools.list().map((t) => t.name),
      taskStats: this.tasks.stats(),
      messageHistory: this.bus.history(undefined, 10),
    };
  }
}
