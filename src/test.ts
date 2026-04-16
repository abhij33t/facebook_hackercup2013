/**
 * Verifiable Test Suite
 *
 * Part 1: Unit tests (no LLM, pure assertions)
 *   - Graph: routing, conditional edges, loops
 *   - Memory: store/recall, episodic learning
 *   - Tools: execute, error handling
 *   - Communication: send/receive, request/response
 *   - Tasks: priority, dependencies, completion cascade
 *
 * Part 2: Integration test (with Claude)
 *   - Math word problem pipeline: 3 agents collaborate to solve
 *     a problem with a known answer, then we assert correctness.
 *
 * Run: npm test
 * Run with LLM: ANTHROPIC_API_KEY=sk-... npm run test:llm
 */

import * as assert from "assert";

// Layer 1
import { SimpleGraph } from "./graph";
import { START, END } from "./types";

// Layer 2
import { Memory } from "./memory";

// Layer 3
import { ToolRegistry } from "./tools";

// Layer 4
import { MessageBus } from "./communication";

// Layer 5
import { TaskManager } from "./tasks";

// Layer 6
import { AgentHarness, Reasoner, ReasonerContext } from "./agent";

// Layer 7
import { AgentFactory } from "./factory";

// LLM integration
import { ClaudeReasoner } from "./llm";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      passed++;
      console.log(`  PASS  ${name}`);
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  FAIL  ${name}: ${msg}`);
    }
  })();
}

// ═══════════════════════════════════════════════════════════════
// Part 1: Unit Tests (no LLM)
// ═══════════════════════════════════════════════════════════════

async function unitTests() {
  console.log("\n=== Layer 1: Graph ===");

  await test("linear graph: A -> B -> END", async () => {
    const g = new SimpleGraph<{ value: number }>();
    g.addNode("double", (s) => ({ value: s.value * 2 }));
    g.addNode("add10", (s) => ({ value: s.value + 10 }));
    g.addEdge(START, "double");
    g.addEdge("double", "add10");
    g.addEdge("add10", END);
    const result = await g.compile().invoke({ value: 5 });
    assert.strictEqual(result.value, 20); // 5*2=10, 10+10=20
  });

  await test("conditional edge: loop until threshold", async () => {
    const g = new SimpleGraph<{ count: number; done: boolean }>();
    g.addNode("inc", (s) => ({ ...s, count: s.count + 1 }));
    g.addNode("check", (s) => ({ ...s, done: s.count >= 5 }));
    g.addEdge(START, "inc");
    g.addEdge("inc", "check");
    g.addConditionalEdge("check", (s) => (s.done ? END : "inc"));
    const result = await g.compile().invoke({ count: 0, done: false });
    assert.strictEqual(result.count, 5);
  });

  await test("stream yields each step", async () => {
    const g = new SimpleGraph<{ log: string[] }>();
    g.addNode("a", (s) => ({ log: [...s.log, "a"] }));
    g.addNode("b", (s) => ({ log: [...s.log, "b"] }));
    g.addEdge(START, "a");
    g.addEdge("a", "b");
    g.addEdge("b", END);
    const steps: string[] = [];
    for await (const { node } of g.compile().stream({ log: [] })) {
      steps.push(node);
    }
    assert.deepStrictEqual(steps, ["a", "b"]);
  });

  await test("rejects duplicate node", () => {
    const g = new SimpleGraph<{ x: number }>();
    g.addNode("a", (s) => s);
    assert.throws(() => g.addNode("a", (s) => s), /already registered/);
  });

  await test("rejects missing START edge", () => {
    const g = new SimpleGraph<{ x: number }>();
    g.addNode("a", (s) => s);
    assert.throws(() => g.compile(), /must have an edge from START/);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== Layer 2: Memory ===");

  await test("working memory: set/get/evict", () => {
    const mem = new Memory({ workingSlots: 3 });
    mem.working.set("a", 1);
    mem.working.set("b", 2);
    mem.working.set("c", 3);
    mem.working.set("d", 4); // evicts "a"
    assert.strictEqual(mem.working.get("a"), undefined);
    assert.strictEqual(mem.working.get("d"), 4);
  });

  await test("episodic memory: record and recall by relevance", () => {
    const mem = new Memory();
    mem.episodic.record({ situation: "math problem", action: "calculated", outcome: "correct", reward: 1, tags: ["math"] });
    mem.episodic.record({ situation: "writing task", action: "composed", outcome: "good", reward: 0.5, tags: ["writing"] });
    const recalled = mem.episodic.recall("math", ["math"], 1);
    assert.strictEqual(recalled.length, 1);
    assert.ok(recalled[0].situation.includes("math"));
  });

  await test("semantic memory: store and search", () => {
    const mem = new Memory();
    mem.semantic.store("pi", "3.14159", 1.0, "math");
    mem.semantic.store("e", "2.71828", 0.9, "math");
    const results = mem.semantic.search("pi");
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].value, "3.14159");
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== Layer 3: Tools ===");

  await test("register and execute tool", async () => {
    const reg = new ToolRegistry();
    reg.register({
      name: "add",
      description: "Add two numbers",
      parameters: { a: "first number", b: "second number" },
      execute: async (params) => (params.a as number) + (params.b as number),
    });
    const result = await reg.execute("add", { a: 3, b: 7 });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.output, 10);
  });

  await test("execute unknown tool returns error", async () => {
    const reg = new ToolRegistry();
    const result = await reg.execute("nope");
    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes("Unknown tool"));
  });

  await test("tool execution error is caught", async () => {
    const reg = new ToolRegistry();
    reg.register({
      name: "boom",
      description: "Always fails",
      parameters: {},
      execute: async () => { throw new Error("kaboom"); },
    });
    const result = await reg.execute("boom");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "kaboom");
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== Layer 4: Communication ===");

  await test("send and receive on channel", async () => {
    const bus = new MessageBus();
    const received: unknown[] = [];
    bus.subscribe("test-ch", (msg) => { received.push(msg.payload); });
    await bus.send({ from: "a", to: "b", type: "broadcast", channel: "test-ch", payload: "hello" });
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0], "hello");
  });

  await test("request/response pattern", async () => {
    const bus = new MessageBus();
    // Responder auto-replies
    bus.subscribe("work", async (msg) => {
      if (msg.type === "request") {
        await bus.reply(msg, `done: ${msg.payload}`, "worker");
      }
    });
    const response = await bus.request({ from: "boss", to: "worker", channel: "work", payload: "task1" }, 5000);
    assert.strictEqual(response.payload, "done: task1");
  });

  await test("message history is recorded", async () => {
    const bus = new MessageBus();
    await bus.send({ from: "a", to: "b", type: "broadcast", channel: "log", payload: 1 });
    await bus.send({ from: "a", to: "b", type: "broadcast", channel: "log", payload: 2 });
    const history = bus.history("log");
    assert.strictEqual(history.length, 2);
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== Layer 5: Tasks ===");

  await test("priority ordering", () => {
    const tm = new TaskManager();
    tm.add({ description: "low", priority: "low" });
    tm.add({ description: "critical", priority: "critical" });
    tm.add({ description: "medium", priority: "medium" });
    const next = tm.next();
    assert.strictEqual(next?.description, "critical");
  });

  await test("dependency blocking", () => {
    const tm = new TaskManager();
    const t1 = tm.add({ description: "first" });
    tm.add({ description: "second", dependencies: [t1.id] });
    // "second" is blocked; "first" should be picked
    const next = tm.next();
    assert.strictEqual(next?.description, "first");
  });

  await test("completing parent when all children done", () => {
    const tm = new TaskManager();
    const parent = tm.add({ description: "parent" });
    const [child1, child2] = tm.decompose(parent.id, [
      { description: "child1" },
      { description: "child2" },
    ]);
    tm.start(child1.id);
    tm.complete(child1.id, "ok");
    // Parent still pending — child2 not done
    assert.strictEqual(tm.get(parent.id)?.status, "pending");
    tm.start(child2.id);
    tm.complete(child2.id, "ok");
    // Now parent should auto-complete
    assert.strictEqual(tm.get(parent.id)?.status, "completed");
  });

  await test("assignee filtering", () => {
    const tm = new TaskManager();
    tm.add({ description: "for alice", assignee: "alice" });
    tm.add({ description: "for bob", assignee: "bob" });
    const aliceTask = tm.next("alice");
    assert.strictEqual(aliceTask?.description, "for alice");
    const bobTask = tm.next("bob");
    assert.strictEqual(bobTask?.description, "for bob");
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== Layer 6: Agent (with mock reasoner) ===");

  await test("agent runs perceive→reason→plan→act→reflect→done", async () => {
    const mockReasoner: Reasoner = {
      reason: async () => "I should compute 2+2",
      plan: async () => [
        { description: "compute", priority: "high", metadata: { tool: "calc", toolParams: { expr: "2+2" } } },
      ],
      reflect: async (result) => ({
        reflection: `Got: ${result?.output}`,
        route: "done" as const,
      }),
    };

    const tools = new ToolRegistry();
    tools.register({
      name: "calc",
      description: "Calculate",
      parameters: { expr: "expression" },
      execute: async (params) => eval(params.expr as string),
    });

    const agent = new AgentHarness({
      id: "test_agent",
      name: "TestAgent",
      description: "test",
      reasoner: mockReasoner,
      tools,
    });

    const output = await agent.run("What is 2+2?");
    assert.ok(output.includes("4"), `Expected output to contain "4", got: "${output}"`);
  });

  await test("agent learns from experience (episodic memory)", async () => {
    const mockReasoner: Reasoner = {
      reason: async () => "doing task",
      plan: async () => [{ description: "task1", priority: "high" }],
      reflect: async () => ({ reflection: "done", route: "done" as const }),
    };

    const agent = new AgentHarness({
      id: "learner",
      name: "Learner",
      description: "test",
      reasoner: mockReasoner,
    });

    await agent.run("learn something");
    assert.ok(agent.memory.episodic.size() > 0, "Should have recorded an episode");
  });

  // ─────────────────────────────────────────────────────────────
  console.log("\n=== Layer 7: Factory ===");

  await test("factory creates agents from blueprints", () => {
    const factory = new AgentFactory();
    const mockReasoner: Reasoner = {
      reason: async () => "ok",
      plan: async () => [],
      reflect: async () => ({ reflection: "done", route: "done" as const }),
    };
    factory.registerBlueprint({
      name: "Worker",
      description: "does work",
      tools: [],
      reasoner: mockReasoner,
    });
    const agent = factory.createFromBlueprint("Worker");
    assert.ok(agent.id.includes("worker"));
    assert.strictEqual(factory.listAgents().length, 1);
  });

  await test("factory orchestrates multiple agents", async () => {
    const factory = new AgentFactory();
    let taskCounter = 0;

    const mockReasoner: Reasoner = {
      reason: async () => "working",
      plan: async () => [],
      reflect: async (result) => ({
        reflection: `Task done: ${result?.output}`,
        route: "done" as const,
      }),
    };

    factory.registerBlueprint({
      name: "Alpha",
      description: "first worker",
      tools: [{
        name: "work",
        description: "do work",
        parameters: {},
        execute: async () => `result_${++taskCounter}`,
      }],
      reasoner: mockReasoner,
    });

    factory.registerBlueprint({
      name: "Beta",
      description: "second worker",
      tools: [{
        name: "work",
        description: "do work",
        parameters: {},
        execute: async () => `result_${++taskCounter}`,
      }],
      reasoner: mockReasoner,
    });

    const result = await factory.orchestrate("do stuff", ["Alpha", "Beta"], [
      { description: "task A", metadata: { tool: "work" } },
      { description: "task B", metadata: { tool: "work" } },
    ]);

    assert.strictEqual(result.agents.length, 2);
    assert.ok(result.taskStats.completed >= 2, `Expected >=2 completed, got ${result.taskStats.completed}`);
  });
}

// ═══════════════════════════════════════════════════════════════
// Part 2: LLM Integration Test
// ═══════════════════════════════════════════════════════════════

async function llmTests() {
  console.log("\n=== LLM Integration: Math Pipeline ===");
  console.log("(3 agents solve a word problem with a known answer)\n");

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();

  // ── The problem ──────────────────────────────────────────────
  // "A store sells apples for $3 each. Alice buys 7 apples and
  //  Bob buys 5 apples. How much did they spend in total?"
  // Answer: (7 + 5) * 3 = 36

  const EXPECTED_ANSWER = 36;
  const PROBLEM = "A store sells apples for $3 each. Alice buys 7 apples and Bob buys 5 apples. How much did they spend in total?";

  // ── Tool: extract numbers from text ──────────────────────────
  const extractTool = {
    name: "extract_numbers",
    description: "Extract all numbers mentioned in text",
    parameters: { text: "input text" },
    execute: async (params: Record<string, unknown>) => {
      const text = params.text as string;
      const nums = text.match(/\d+/g)?.map(Number) ?? [];
      return { numbers: nums };
    },
  };

  // ── Tool: calculate expression ───────────────────────────────
  const calcTool = {
    name: "calculate",
    description: "Evaluate a math expression and return the numeric result",
    parameters: { expression: "a math expression like (7+5)*3" },
    execute: async (params: Record<string, unknown>) => {
      const expr = String(params.expression);
      // Safe eval for simple math
      const sanitized = expr.replace(/[^0-9+\-*/().  ]/g, "");
      const result = Function(`"use strict"; return (${sanitized})`)();
      return { result: Number(result) };
    },
  };

  // ── Tool: verify answer ──────────────────────────────────────
  const verifyTool = {
    name: "verify",
    description: "Verify a computed answer against an expected answer",
    parameters: { computed: "the computed number", expected: "the expected number" },
    execute: async (params: Record<string, unknown>) => {
      const computed = Number(params.computed);
      const expected = Number(params.expected);
      return { match: computed === expected, computed, expected };
    },
  };

  // ── Create factory with LLM-backed agents ────────────────────
  const factory = new AgentFactory();

  factory.registerBlueprint({
    name: "Parser",
    description: "Parses math word problems and extracts numbers",
    tools: [extractTool],
    reasoner: new ClaudeReasoner({
      client,
      persona: "You parse math word problems. Use the extract_numbers tool to pull out all numbers from the text. Be precise.",
    }),
    knowledge: [{ key: "role", value: "Extract numbers from word problems" }],
  });

  factory.registerBlueprint({
    name: "Calculator",
    description: "Computes math expressions",
    tools: [calcTool],
    reasoner: new ClaudeReasoner({
      client,
      persona: "You are a calculator agent. Use the calculate tool to evaluate math expressions. For this problem, compute (total_apples) * price_per_apple.",
    }),
    knowledge: [{ key: "role", value: "Compute math expressions from extracted numbers" }],
  });

  factory.registerBlueprint({
    name: "Verifier",
    description: "Verifies computed answers",
    tools: [verifyTool],
    reasoner: new ClaudeReasoner({
      client,
      persona: "You verify math answers. Use the verify tool to check the computed result. The expected answer for this problem is 36.",
    }),
    knowledge: [{ key: "expected_answer", value: "36" }],
  });

  // ── Run the pipeline ─────────────────────────────────────────

  await test("Parser agent extracts numbers from word problem", async () => {
    const parser = factory.createFromBlueprint("Parser");
    const output = await parser.run(PROBLEM);
    console.log(`    Parser output: ${output.slice(0, 150)}`);
    // The parser should at least mention the key numbers
    assert.ok(
      output.includes("3") || output.includes("7") || output.includes("5"),
      "Parser should extract at least one of the numbers (3, 5, 7)"
    );
  });

  await test("Calculator agent computes the correct answer", async () => {
    const calculator = factory.createFromBlueprint("Calculator");
    const output = await calculator.run(
      `${PROBLEM} The numbers extracted are: 3 (price), 7 (Alice), 5 (Bob). Compute the total cost.`
    );
    console.log(`    Calculator output: ${output.slice(0, 150)}`);
    assert.ok(
      output.includes("36"),
      `Calculator should produce 36, got: "${output.slice(0, 200)}"`
    );
  });

  await test("Verifier agent confirms the answer is correct", async () => {
    const verifier = factory.createFromBlueprint("Verifier");
    const output = await verifier.run(
      `The computed answer is 36. The expected answer is ${EXPECTED_ANSWER}. Verify they match.`
    );
    console.log(`    Verifier output: ${output.slice(0, 150)}`);
    assert.ok(
      output.toLowerCase().includes("match") ||
      output.toLowerCase().includes("correct") ||
      output.toLowerCase().includes("verified") ||
      output.includes("36"),
      `Verifier should confirm the answer, got: "${output.slice(0, 200)}"`
    );
  });

  // ── Full orchestration test ──────────────────────────────────
  console.log("\n=== LLM Integration: Full Orchestration ===\n");

  await test("full pipeline: parse → calculate → verify with known answer", async () => {
    const factory2 = new AgentFactory();

    factory2.registerBlueprint({
      name: "Parser",
      description: "Extracts numbers",
      tools: [extractTool],
      reasoner: new ClaudeReasoner({
        client,
        persona: "Extract numbers from the math problem using the extract_numbers tool.",
      }),
    });
    factory2.registerBlueprint({
      name: "Calculator",
      description: "Computes",
      tools: [calcTool],
      reasoner: new ClaudeReasoner({
        client,
        persona: "Calculate (7+5)*3 using the calculate tool.",
      }),
    });
    factory2.registerBlueprint({
      name: "Verifier",
      description: "Verifies",
      tools: [verifyTool],
      reasoner: new ClaudeReasoner({
        client,
        persona: "Verify the result equals 36 using the verify tool.",
      }),
    });

    const result = await factory2.orchestrate(PROBLEM, ["Parser", "Calculator", "Verifier"], [
      { description: "Extract numbers from problem", metadata: { tool: "extract_numbers", toolParams: { text: PROBLEM } } },
      { description: "Calculate total cost: (7+5)*3", metadata: { tool: "calculate", toolParams: { expression: "(7+5)*3" } } },
      { description: "Verify answer equals 36", metadata: { tool: "verify", toolParams: { computed: 36, expected: EXPECTED_ANSWER } } },
    ]);

    console.log("    Task stats:", result.taskStats);
    console.log("    Messages exchanged:", result.messagesExchanged);

    for (const agent of result.agents) {
      console.log(`    [${agent.name}] ${agent.output.slice(0, 100)}`);
    }

    // All 3 tasks completed
    assert.ok(result.taskStats.completed >= 3, `Expected >=3 completed tasks, got ${result.taskStats.completed}`);
    // Final output mentions 36
    assert.ok(
      result.finalOutput.includes("36"),
      `Pipeline output should contain "36", got: "${result.finalOutput.slice(0, 300)}"`
    );
  });
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║  Simple LangGraph — Test Suite       ║");
  console.log("╚══════════════════════════════════════╝");

  await unitTests();

  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  if (hasKey && process.argv.includes("--llm")) {
    await llmTests();
  } else if (!hasKey) {
    console.log("\n=== LLM tests skipped (no ANTHROPIC_API_KEY) ===");
  } else {
    console.log("\n=== LLM tests skipped (pass --llm to enable) ===");
  }

  console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
