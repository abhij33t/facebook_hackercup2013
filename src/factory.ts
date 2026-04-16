/**
 * Layer 7: AgentFactory — Agents that Build Agents
 *
 * This is the meta-scaling layer. Just like an LLM can be prompted for any task,
 * the factory can spin up a specialized agent for any sub-problem.
 *
 * How it scales:
 *   - Given a problem, decompose it into roles
 *   - Create a specialized agent per role (with curated tools + memory)
 *   - Wire them together via the shared message bus
 *   - Orchestrate execution and collect results
 *
 * This is the "pre-training → fine-tuning → prompting" equivalent:
 *   - AgentHarness is the base model (pre-trained architecture)
 *   - AgentBlueprint is the fine-tune (specialized config)
 *   - The input prompt at runtime is the prompt
 */

import { AgentHarness, AgentConfig, Reasoner, ReasonerContext } from "./agent";
import { ToolRegistry, ToolDefinition } from "./tools";
import { Memory } from "./memory";
import { MessageBus, Message } from "./communication";
import { TaskManager, TaskCreate } from "./tasks";

// ── Blueprint: a recipe for building an agent ──────────────────────

export interface AgentBlueprint {
  name: string;
  description: string;
  tools: ToolDefinition[];
  reasoner: Reasoner;
  /** Pre-loaded knowledge for the agent's semantic memory. */
  knowledge?: Array<{ key: string; value: string }>;
}

// ── Orchestration result ───────────────────────────────────────────

export interface OrchestrationResult {
  agents: Array<{ id: string; name: string; output: string }>;
  finalOutput: string;
  taskStats: Record<string, number>;
  messagesExchanged: number;
}

// ── The Factory ────────────────────────────────────────────────────

export class AgentFactory {
  private blueprints = new Map<string, AgentBlueprint>();
  private sharedBus: MessageBus;
  private sharedTasks: TaskManager;
  private agents = new Map<string, AgentHarness>();
  private nextAgentNum = 0;

  constructor(bus?: MessageBus, tasks?: TaskManager) {
    this.sharedBus = bus ?? new MessageBus();
    this.sharedTasks = tasks ?? new TaskManager();
  }

  /** Register a reusable blueprint for creating agents. */
  registerBlueprint(blueprint: AgentBlueprint): this {
    this.blueprints.set(blueprint.name, blueprint);
    return this;
  }

  /** Create an agent from a registered blueprint. */
  createFromBlueprint(blueprintName: string): AgentHarness {
    const bp = this.blueprints.get(blueprintName);
    if (!bp) throw new Error(`Unknown blueprint "${blueprintName}"`);
    return this.createAgent(bp);
  }

  /** Create an agent from an inline blueprint. */
  createAgent(blueprint: AgentBlueprint): AgentHarness {
    const id = `agent_${++this.nextAgentNum}_${blueprint.name.replace(/\s+/g, "_").toLowerCase()}`;

    const tools = new ToolRegistry();
    for (const t of blueprint.tools) tools.register(t);

    const memory = new Memory();
    if (blueprint.knowledge) {
      for (const k of blueprint.knowledge) {
        memory.semantic.store(k.key, k.value, 1.0, "factory_bootstrap");
      }
    }

    const agent = new AgentHarness({
      id,
      name: blueprint.name,
      description: blueprint.description,
      reasoner: blueprint.reasoner,
      tools,
      memory,
      bus: this.sharedBus,
      tasks: this.sharedTasks,
    });

    this.agents.set(id, agent);

    // Auto-subscribe the agent to its own channel on the bus
    this.sharedBus.subscribe(id, (msg: Message) => {
      if (msg.to === id && msg.type === "request") {
        agent.handleMessage(msg);
      }
    });

    return agent;
  }

  /**
   * Orchestrate: given a goal and a set of blueprint names,
   * create agents, assign tasks, and run them in sequence
   * (respecting task dependencies).
   */
  async orchestrate(
    goal: string,
    blueprintNames: string[],
    taskPlan: TaskCreate[]
  ): Promise<OrchestrationResult> {
    // 1. Create agents from blueprints
    const agents: AgentHarness[] = [];
    for (const name of blueprintNames) {
      agents.push(this.createFromBlueprint(name));
    }

    // 2. Register tasks, assigning each to its corresponding agent (by index).
    //    Tasks beyond the agent count remain unassigned (first available picks them up).
    const taskIds: string[] = [];
    for (let i = 0; i < taskPlan.length; i++) {
      const assignee = i < agents.length ? agents[i].id : undefined;
      const task = this.sharedTasks.add({ ...taskPlan[i], assignee });
      taskIds.push(task.id);
    }

    // 3. Wire up task dependencies using actual IDs.
    //    taskPlan entries can reference dependencies by index: metadata.depIndices = [0, 1]
    for (let i = 0; i < taskPlan.length; i++) {
      const depIndices = taskPlan[i].metadata?.depIndices as number[] | undefined;
      if (depIndices) {
        const task = this.sharedTasks.get(taskIds[i]);
        if (task) {
          task.dependencies = depIndices.map((idx) => taskIds[idx]);
        }
      }
    }

    // 4. Run agents in sequence — each picks up its assigned task
    const results: Array<{ id: string; name: string; output: string }> = [];

    for (const agent of agents) {
      const output = await agent.run(goal);
      results.push({ id: agent.id, name: agent.name, output });
    }

    // 5. Collect results
    return {
      agents: results,
      finalOutput: results.map((r) => r.output).join("\n\n"),
      taskStats: this.sharedTasks.stats(),
      messagesExchanged: this.sharedBus.history(undefined, 1000).length,
    };
  }

  /** List all live agents. */
  listAgents(): Array<{ id: string; name: string; description: string }> {
    return [...this.agents.values()].map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
    }));
  }

  /** Get the shared bus (for wiring human-in-the-loop, monitoring, etc). */
  get bus(): MessageBus {
    return this.sharedBus;
  }

  /** Get the shared task manager. */
  get tasks(): TaskManager {
    return this.sharedTasks;
  }

  /** Get a live agent by ID. */
  getAgent(id: string): AgentHarness | undefined {
    return this.agents.get(id);
  }
}
