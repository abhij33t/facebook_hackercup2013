import { START, END, Edge, NodeEntry, NodeFunction, ConditionalEdgeFn } from "./types";

/**
 * SimpleGraph — a minimal LangGraph-style state graph.
 *
 * Usage:
 *   1. Create a graph:        const g = new SimpleGraph<MyState>();
 *   2. Add nodes:             g.addNode("greet", (s) => ({ ...s, msg: "hi" }));
 *   3. Wire edges:            g.addEdge(START, "greet");
 *                             g.addEdge("greet", END);
 *      Or conditional edges:  g.addConditionalEdge("router", (s) => s.next);
 *   4. Compile & run:         const result = await g.compile().invoke(initialState);
 */
export class SimpleGraph<S extends object> {
  private nodes = new Map<string, NodeEntry<S>>();
  private edges = new Map<string, Edge<S>>();

  /** Register a named node with its handler function. */
  addNode(name: string, fn: NodeFunction<S>): this {
    if (name === START || name === END) {
      throw new Error(`Cannot use reserved name "${name}" as a node`);
    }
    if (this.nodes.has(name)) {
      throw new Error(`Node "${name}" is already registered`);
    }
    this.nodes.set(name, { name, fn });
    return this;
  }

  /** Add a direct edge: when `from` finishes, go to `to`. */
  addEdge(from: string, to: string): this {
    this.validateEdgeSource(from);
    this.validateEdgeTarget(to);
    if (this.edges.has(from)) {
      throw new Error(`Edge from "${from}" already exists — use addConditionalEdge for branching`);
    }
    this.edges.set(from, { type: "direct", target: to });
    return this;
  }

  /** Add a conditional edge: when `from` finishes, call `fn(state)` to decide the next node. */
  addConditionalEdge(from: string, fn: ConditionalEdgeFn<S>): this {
    this.validateEdgeSource(from);
    if (this.edges.has(from)) {
      throw new Error(`Edge from "${from}" already exists`);
    }
    this.edges.set(from, { type: "conditional", fn });
    return this;
  }

  /** Validate the graph and return an executable CompiledGraph. */
  compile(): CompiledGraph<S> {
    if (!this.edges.has(START)) {
      throw new Error("Graph must have an edge from START");
    }
    // Ensure every node referenced by an edge exists (except START/END).
    for (const [from, edge] of this.edges) {
      if (from !== START && !this.nodes.has(from)) {
        throw new Error(`Edge references unknown source node "${from}"`);
      }
      if (edge.type === "direct" && edge.target !== END && !this.nodes.has(edge.target)) {
        throw new Error(`Edge references unknown target node "${edge.target}"`);
      }
    }
    return new CompiledGraph(this.nodes, this.edges);
  }

  private validateEdgeSource(name: string) {
    if (name === END) throw new Error("Cannot add an edge from END");
  }

  private validateEdgeTarget(name: string) {
    if (name === START) throw new Error("Cannot add an edge to START");
  }
}

/** A compiled, executable graph. */
export class CompiledGraph<S extends object> {
  private maxSteps: number;

  constructor(
    private nodes: Map<string, NodeEntry<S>>,
    private edges: Map<string, Edge<S>>,
    maxSteps = 100
  ) {
    this.maxSteps = maxSteps;
  }

  /** Run the graph to completion, returning the final state. */
  async invoke(initialState: S): Promise<S> {
    let current = this.resolveNext(START, initialState);
    let state = { ...initialState };
    let steps = 0;

    while (true) {
      const next = await current;
      if (next === END) break;
      if (++steps > this.maxSteps) {
        throw new Error(`Graph exceeded maximum of ${this.maxSteps} steps — possible infinite loop`);
      }

      const node = this.nodes.get(next);
      if (!node) throw new Error(`Runtime error: node "${next}" not found`);

      // Run the node and merge its output into state.
      const result = await node.fn(state);
      state = { ...state, ...result };

      current = this.resolveNext(next, state);
    }

    return state;
  }

  /** Stream execution, yielding { node, state } after each step. */
  async *stream(initialState: S): AsyncGenerator<{ node: string; state: S }> {
    let current = this.resolveNext(START, initialState);
    let state = { ...initialState };
    let steps = 0;

    while (true) {
      const next = await current;
      if (next === END) break;
      if (++steps > this.maxSteps) {
        throw new Error(`Graph exceeded maximum of ${this.maxSteps} steps — possible infinite loop`);
      }

      const node = this.nodes.get(next);
      if (!node) throw new Error(`Runtime error: node "${next}" not found`);

      const result = await node.fn(state);
      state = { ...state, ...result };

      yield { node: next, state };

      current = this.resolveNext(next, state);
    }
  }

  private async resolveNext(from: string, state: S): Promise<string> {
    const edge = this.edges.get(from);
    if (!edge) throw new Error(`No edge defined from "${from}"`);
    if (edge.type === "direct") return edge.target;
    return edge.fn(state);
  }
}
