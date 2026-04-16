import { SimpleGraph, START, END } from "./index";

// ── Define your state shape ─────────────────────────────────────────
interface AgentState {
  input: string;
  classification: string;
  response: string;
  steps: string[];
}

// ── Build the graph ─────────────────────────────────────────────────
const graph = new SimpleGraph<AgentState>();

// Node 1: Classify the input
graph.addNode("classify", (state) => {
  const lower = state.input.toLowerCase();
  const classification = lower.includes("help")
    ? "support"
    : lower.includes("buy") || lower.includes("price")
    ? "sales"
    : "general";

  return {
    ...state,
    classification,
    steps: [...state.steps, `classified as "${classification}"`],
  };
});

// Node 2a: Handle support queries
graph.addNode("support", (state) => ({
  ...state,
  response: `Support: We're here to help with "${state.input}". A ticket has been created.`,
  steps: [...state.steps, "routed to support"],
}));

// Node 2b: Handle sales queries
graph.addNode("sales", (state) => ({
  ...state,
  response: `Sales: Thanks for your interest! A sales rep will follow up about "${state.input}".`,
  steps: [...state.steps, "routed to sales"],
}));

// Node 2c: Handle general queries
graph.addNode("general", (state) => ({
  ...state,
  response: `General: Thanks for reaching out. We received "${state.input}".`,
  steps: [...state.steps, "routed to general"],
}));

// ── Wire the edges ──────────────────────────────────────────────────
//   START -> classify -> (conditional) -> support/sales/general -> END

graph.addEdge(START, "classify");

graph.addConditionalEdge("classify", (state) => state.classification);

graph.addEdge("support", END);
graph.addEdge("sales", END);
graph.addEdge("general", END);

// ── Run it ──────────────────────────────────────────────────────────
async function main() {
  const compiled = graph.compile();

  const inputs = [
    "I need help resetting my password",
    "I want to buy the pro plan",
    "Hello, just checking in",
  ];

  for (const input of inputs) {
    console.log(`\n--- Input: "${input}" ---`);

    // Option A: invoke — get final state
    const result = await compiled.invoke({
      input,
      classification: "",
      response: "",
      steps: [],
    });

    console.log("  Steps:", result.steps.join(" -> "));
    console.log("  Response:", result.response);
  }

  // Demonstrate streaming
  console.log("\n--- Streaming demo ---");
  const stream = compiled.stream({
    input: "help me with billing",
    classification: "",
    response: "",
    steps: [],
  });

  for await (const { node, state } of stream) {
    console.log(`  [${node}] steps so far:`, state.steps);
  }
}

main().catch(console.error);
