/**
 * Enterprise Example: Multi-Agent Research Team
 *
 * Demonstrates:
 *   - AgentFactory creating specialized agents from blueprints
 *   - Agents with different tools and knowledge
 *   - Shared message bus for communication
 *   - Task decomposition with dependencies
 *   - Episodic memory (learning from outcomes)
 *   - Human-in-the-loop escalation
 *
 * The scenario: a "Researcher" agent gathers data, then a "Writer" agent
 * composes a report, and a "Reviewer" agent checks it.
 */

import { AgentFactory, AgentBlueprint } from "./factory";
import { Reasoner, ReasonerContext } from "./agent";
import { ToolDefinition } from "./tools";
import { TaskCreate } from "./tasks";

// ═══════════════════════════════════════════════════════════════════
// 1. Define Tools (pluggable capabilities)
// ═══════════════════════════════════════════════════════════════════

const searchTool: ToolDefinition = {
  name: "search",
  description: "Search for information on a topic",
  parameters: { query: "The search query" },
  execute: async (params) => {
    const query = params.query as string;
    // Simulated search results
    return {
      results: [
        `[Source A] Key finding about "${query}": efficiency improved 40% with new approach.`,
        `[Source B] Study shows "${query}" adoption growing 25% year-over-year.`,
        `[Source C] Expert analysis: "${query}" is transforming the industry landscape.`,
      ],
    };
  },
};

const writeTool: ToolDefinition = {
  name: "compose",
  description: "Compose a written document from research",
  parameters: { topic: "Topic", findings: "Research findings" },
  execute: async (params) => {
    const topic = params.topic as string;
    const findings = params.findings as string;
    return {
      document: [
        `# Report: ${topic}`,
        "",
        "## Key Findings",
        findings,
        "",
        "## Conclusion",
        `Based on the research, ${topic} shows significant promise with measurable improvements.`,
      ].join("\n"),
    };
  },
};

const reviewTool: ToolDefinition = {
  name: "review",
  description: "Review a document for quality and accuracy",
  parameters: { document: "The document to review" },
  execute: async (params) => {
    const doc = params.document as string;
    return {
      approved: true,
      feedback: `Document reviewed (${doc.length} chars). Quality: good. Accuracy: verified against sources.`,
    };
  },
};

// ═══════════════════════════════════════════════════════════════════
// 2. Define Reasoners (plug in your LLM here — these are rule-based demos)
// ═══════════════════════════════════════════════════════════════════

/**
 * In production, replace these with:
 *   const reasoner: Reasoner = {
 *     reason: (ctx) => myLLM.generate(buildPrompt(ctx)),
 *     plan:   (goal, ctx) => myLLM.generate(buildPlanPrompt(goal, ctx)),
 *     reflect: (result, ctx) => myLLM.generate(buildReflectPrompt(result, ctx)),
 *   };
 */

const researcherReasoner: Reasoner = {
  async reason(ctx: ReasonerContext) {
    return `I need to research "${ctx.input}". I have the search tool available. Let me find relevant information.`;
  },
  async plan(goal: string) {
    return [
      { description: `Search for information about: ${goal}`, priority: "high" as const, metadata: { tool: "search", toolParams: { query: goal } } },
    ];
  },
  async reflect(result) {
    if (result?.success) {
      return { reflection: `Research complete. Found useful data: ${JSON.stringify(result.output).slice(0, 100)}...`, route: "done" as const };
    }
    return { reflection: "Research failed, need to try a different approach.", route: "act" as const };
  },
};

const writerReasoner: Reasoner = {
  async reason(ctx: ReasonerContext) {
    const episodes = ctx.memory.relevantEpisodes;
    const learned = episodes.length > 0
      ? ` I recall from past experience: "${episodes[0].outcome}".`
      : "";
    return `I need to compose a report about "${ctx.input}".${learned} Let me use the compose tool.`;
  },
  async plan(goal: string) {
    return [
      { description: `Compose report about: ${goal}`, priority: "medium" as const, metadata: { tool: "compose", toolParams: { topic: goal, findings: "Efficiency improved 40%, adoption growing 25%, industry transformation underway." } } },
    ];
  },
  async reflect(result) {
    if (result?.success) {
      return { reflection: `Report composed successfully.`, route: "done" as const };
    }
    return { reflection: "Writing failed, escalating to human.", route: "escalate" as const };
  },
};

const reviewerReasoner: Reasoner = {
  async reason(ctx: ReasonerContext) {
    return `I need to review the report about "${ctx.input}" for quality and accuracy.`;
  },
  async plan(goal: string) {
    return [
      { description: `Review report about: ${goal}`, priority: "low" as const, metadata: { tool: "review", toolParams: { document: `Report on ${goal}` } } },
    ];
  },
  async reflect(result) {
    if (result?.success) {
      const output = result.output as { approved: boolean; feedback: string };
      return {
        reflection: output.approved ? `Review passed: ${output.feedback}` : "Review flagged issues, sending back for revision.",
        route: "done" as const,
      };
    }
    return { reflection: "Review encountered an error.", route: "escalate" as const };
  },
};

// ═══════════════════════════════════════════════════════════════════
// 3. Define Blueprints (reusable agent recipes)
// ═══════════════════════════════════════════════════════════════════

const researcherBlueprint: AgentBlueprint = {
  name: "Researcher",
  description: "Gathers and synthesizes information from various sources",
  tools: [searchTool],
  reasoner: researcherReasoner,
  knowledge: [
    { key: "research_method", value: "Always verify findings from multiple sources" },
    { key: "citation_style", value: "Include source attribution for all claims" },
  ],
};

const writerBlueprint: AgentBlueprint = {
  name: "Writer",
  description: "Composes clear, structured documents from research",
  tools: [writeTool],
  reasoner: writerReasoner,
  knowledge: [
    { key: "writing_style", value: "Concise, evidence-based, with clear structure" },
  ],
};

const reviewerBlueprint: AgentBlueprint = {
  name: "Reviewer",
  description: "Reviews documents for quality, accuracy, and completeness",
  tools: [reviewTool],
  reasoner: reviewerReasoner,
};

// ═══════════════════════════════════════════════════════════════════
// 4. Run the Multi-Agent Pipeline
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log("=== Enterprise Multi-Agent Demo ===\n");

  // Create the factory (shared bus + task manager)
  const factory = new AgentFactory();

  // Register blueprints
  factory.registerBlueprint(researcherBlueprint);
  factory.registerBlueprint(writerBlueprint);
  factory.registerBlueprint(reviewerBlueprint);

  console.log("Registered blueprints:", factory.listAgents().length === 0 ? "(agents created on demand)" : "");

  // Define the task plan with dependencies
  const goal = "AI-driven automation in manufacturing";

  const taskPlan: TaskCreate[] = [
    { description: `Research: ${goal}`, priority: "high", metadata: { tool: "search", toolParams: { query: goal } } },
    { description: `Write report: ${goal}`, priority: "medium", metadata: { tool: "compose", toolParams: { topic: goal, findings: "Research pending..." } } },
    { description: `Review report: ${goal}`, priority: "low", metadata: { tool: "review", toolParams: { document: `Report on ${goal}` } } },
  ];

  // Orchestrate!
  console.log(`\nGoal: "${goal}"`);
  console.log(`Task plan: ${taskPlan.length} tasks across 3 agents\n`);

  const result = await factory.orchestrate(goal, ["Researcher", "Writer", "Reviewer"], taskPlan);

  // Print results
  console.log("--- Agent Outputs ---\n");
  for (const agent of result.agents) {
    console.log(`[${agent.name}] (${agent.id})`);
    console.log(`  Output: ${agent.output.slice(0, 120)}...`);
    console.log();
  }

  console.log("--- Task Stats ---");
  console.log(result.taskStats);

  console.log(`\n--- Messages Exchanged: ${result.messagesExchanged} ---`);

  // Show that agents learned
  console.log("\n--- Agent Memory (Episodic) ---");
  for (const { id } of result.agents) {
    const agent = factory.getAgent(id);
    if (agent) {
      const episodes = agent.memory.episodic.all();
      console.log(`[${agent.name}] ${episodes.length} episode(s) recorded`);
      for (const ep of episodes) {
        console.log(`  - "${ep.action}" → reward: ${ep.reward}`);
      }
    }
  }

  // Demonstrate: create a new agent dynamically at runtime
  console.log("\n--- Dynamic Agent Creation ---");
  const customAgent = factory.createAgent({
    name: "FactChecker",
    description: "Verifies claims against known facts",
    tools: [searchTool],
    reasoner: researcherReasoner,
    knowledge: [{ key: "method", value: "Cross-reference all claims with primary sources" }],
  });
  console.log(`Created dynamic agent: ${customAgent.name} (${customAgent.id})`);
  console.log(`Total live agents: ${factory.listAgents().length}`);
  console.log(`Factory agents:`, factory.listAgents().map((a) => a.name));

  // Show the human-in-the-loop capability
  console.log("\n--- Human-in-the-Loop Demo ---");
  // In production, wire this to your UI/CLI:
  //   factory.bus.subscribe("human", async (msg) => { ... });
  //   const answer = await factory.bus.requestHuman("agent_1", "Should I proceed?");
  console.log("To enable: factory.bus.subscribe('human', handler)");
  console.log("Then agents can: await this.bus.requestHuman(agentId, 'Need approval')");

  console.log("\n=== Done ===");
}

main().catch(console.error);
