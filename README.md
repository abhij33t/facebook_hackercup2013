# simple-langgraph

A minimal [LangGraph](https://github.com/langchain-ai/langgraph)-style state graph engine in TypeScript — with an enterprise-grade agent harness that scales for any problem-solving scenario.

## Architecture: 7 Layers of Scale

```
┌──────────────────────────────────────────────────────┐
│  Layer 7: AgentFactory — agents that build agents    │
├──────────────────────────────────────────────────────┤
│  Layer 6: AgentHarness — perceive→reason→act→reflect │
├──────────────────────────────────────────────────────┤
│  Layer 5: TaskManager — decompose, prioritize, delegate │
├──────────────────────────────────────────────────────┤
│  Layer 4: MessageBus — agent↔agent, human-in-the-loop │
├──────────────────────────────────────────────────────┤
│  Layer 3: ToolRegistry — extensible capabilities     │
├──────────────────────────────────────────────────────┤
│  Layer 2: Memory — working, episodic, semantic       │
├──────────────────────────────────────────────────────┤
│  Layer 1: SimpleGraph — nodes, edges, state          │
└──────────────────────────────────────────────────────┘
```

Each layer scales independently, like an LLM:
- More **memory** → better decisions (like more training data)
- More **tools** → broader capabilities (like more parameters)
- More **agents** → emergent collaboration (like model scaling)
- Better **reasoner** → smarter behavior (plug in any LLM)

## Quick Start

```bash
npm install
npm run example              # simple graph demo
npm run example:enterprise   # multi-agent collaboration demo
```

## Core Concepts

### Layer 1: State Graph

```typescript
import { SimpleGraph, START, END } from "./index";

const graph = new SimpleGraph<{ count: number; done: boolean }>();
graph.addNode("increment", (s) => ({ ...s, count: s.count + 1 }));
graph.addNode("check", (s) => ({ ...s, done: s.count >= 3 }));
graph.addEdge(START, "increment");
graph.addEdge("increment", "check");
graph.addConditionalEdge("check", (s) => (s.done ? END : "increment"));

const result = await graph.compile().invoke({ count: 0, done: false });
```

### Layer 2–5: Agent Harness

```typescript
import { AgentHarness, Reasoner } from "./index";

const reasoner: Reasoner = {
  reason: async (ctx) => "Analyzing the situation...",
  plan: async (goal) => [{ description: goal, priority: "high" }],
  reflect: async (result) => ({
    reflection: "Task complete",
    route: "done",
  }),
};

const agent = new AgentHarness({
  id: "agent_1",
  name: "MyAgent",
  description: "A helpful agent",
  reasoner,   // plug in your LLM here
});

const output = await agent.run("Solve this problem");
```

### Layer 6–7: Multi-Agent Factory

```typescript
import { AgentFactory } from "./index";

const factory = new AgentFactory();

factory.registerBlueprint({
  name: "Researcher",
  description: "Finds information",
  tools: [searchTool],
  reasoner: researchReasoner,
});

factory.registerBlueprint({
  name: "Writer",
  description: "Composes reports",
  tools: [writeTool],
  reasoner: writeReasoner,
});

// Orchestrate a team of agents
const result = await factory.orchestrate(
  "Analyze market trends",
  ["Researcher", "Writer"],
  taskPlan
);

// Or create agents dynamically at runtime
const custom = factory.createAgent({
  name: "FactChecker",
  tools: [verifyTool],
  reasoner: factCheckReasoner,
});
```

## API Reference

| Module | Key Exports | Purpose |
|--------|------------|---------|
| `graph.ts` | `SimpleGraph`, `CompiledGraph` | State graph engine with `invoke()` and `stream()` |
| `memory.ts` | `Memory`, `WorkingMemory`, `EpisodicMemory`, `SemanticMemory` | Three-tier memory (context window, experiences, knowledge) |
| `tools.ts` | `ToolRegistry`, `ToolDefinition` | Register and execute tools |
| `communication.ts` | `MessageBus`, `Message` | Agent-to-agent messaging, human-in-the-loop |
| `tasks.ts` | `TaskManager`, `Task` | Priority queue with dependencies and delegation |
| `agent.ts` | `AgentHarness`, `Reasoner` | Core perceive→reason→plan→act→reflect loop |
| `factory.ts` | `AgentFactory`, `AgentBlueprint` | Create agents from blueprints, orchestrate teams |

## Pluggable Reasoner

The `Reasoner` interface is where you bring your own LLM:

```typescript
interface Reasoner {
  reason(context: ReasonerContext): Promise<string>;
  plan(goal: string, context: ReasonerContext): Promise<TaskCreate[]>;
  reflect(result: ToolResult | null, context: ReasonerContext): Promise<{
    reflection: string;
    route: "act" | "escalate" | "done";
  }>;
}
```

The `ReasonerContext` gives the LLM everything it needs: input, perception, memory snapshots, available tools, task stats, and message history.
