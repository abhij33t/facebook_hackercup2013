/**
 * Layer 3: Tool Registry
 *
 * Gives agents extensible capabilities — like giving an LLM function-calling.
 * Any function can be a tool: API calls, file I/O, math, spawning sub-agents.
 *
 * Scaling property: more tools → broader capabilities, just like more
 * training data gives an LLM more knowledge.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, string>;  // param name → description
  execute: (params: Record<string, unknown>) => unknown | Promise<unknown>;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  output: unknown;
  error?: string;
  durationMs: number;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  /** Register a tool. */
  register(tool: ToolDefinition): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  /** Unregister a tool. */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Execute a tool by name. */
  async execute(name: string, params: Record<string, unknown> = {}): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { tool: name, success: false, output: null, error: `Unknown tool "${name}"`, durationMs: 0 };
    }
    const start = Date.now();
    try {
      const output = await tool.execute(params);
      return { tool: name, success: true, output, durationMs: Date.now() - start };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { tool: name, success: false, output: null, error: msg, durationMs: Date.now() - start };
    }
  }

  /** List all tools (for agent introspection / LLM prompt building). */
  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Describe all tools in a format suitable for an LLM system prompt. */
  describe(): string {
    return this.list()
      .map((t) => {
        const params = Object.entries(t.parameters)
          .map(([k, v]) => `    ${k}: ${v}`)
          .join("\n");
        return `- ${t.name}: ${t.description}\n  Parameters:\n${params}`;
      })
      .join("\n\n");
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
}
