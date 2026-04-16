# simple-langgraph

A minimal [LangGraph](https://github.com/langchain-ai/langgraph)-style state graph engine in TypeScript.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **State** | A plain object that flows through the graph, updated by each node |
| **Node** | A named function `(state) => state` that transforms state |
| **Edge** | A direct connection from one node to another |
| **Conditional Edge** | A function that inspects state and returns the next node name |
| **START / END** | Sentinel markers for the entry and exit of the graph |

## Quick Start

```bash
npm install
npm run example
```

## Usage

```typescript
import { SimpleGraph, START, END } from "./index";

interface MyState {
  count: number;
  done: boolean;
}

const graph = new SimpleGraph<MyState>();

graph.addNode("increment", (s) => ({ ...s, count: s.count + 1 }));
graph.addNode("check", (s) => ({ ...s, done: s.count >= 3 }));

graph.addEdge(START, "increment");
graph.addEdge("increment", "check");
graph.addConditionalEdge("check", (s) => (s.done ? END : "increment"));

const result = await graph.compile().invoke({ count: 0, done: false });
// result.count === 3
```

## API

### `SimpleGraph<S>`

- **`addNode(name, fn)`** — Register a node. `fn` receives state and returns updated state (sync or async).
- **`addEdge(from, to)`** — Add a direct edge between two nodes (or START/END).
- **`addConditionalEdge(from, fn)`** — Add a branching edge. `fn(state)` returns the next node name.
- **`compile()`** — Validate and return a `CompiledGraph`.

### `CompiledGraph<S>`

- **`invoke(initialState)`** — Run the graph to completion, return final state.
- **`stream(initialState)`** — AsyncGenerator yielding `{ node, state }` after each step.
