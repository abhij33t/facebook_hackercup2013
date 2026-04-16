/** A node function receives state and returns updated (partial or full) state. */
export type NodeFunction<S> = (state: S) => S | Promise<S>;

/** A conditional edge function receives state and returns the name of the next node. */
export type ConditionalEdgeFn<S> = (state: S) => string | Promise<string>;

/** Reserved sentinel node names. */
export const START = "__start__";
export const END = "__end__";

/** Internal representation of an edge. */
export type Edge<S> =
  | { type: "direct"; target: string }
  | { type: "conditional"; fn: ConditionalEdgeFn<S> };

/** Internal representation of a registered node. */
export interface NodeEntry<S> {
  name: string;
  fn: NodeFunction<S>;
}
