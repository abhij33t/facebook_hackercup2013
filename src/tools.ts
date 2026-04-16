/**
 * Layer 3: Tool Registry — fully typed with validation.
 */

/** Typed, validated parameter bag passed to tool execution. */
export class ToolParams {
  private readonly entries: Readonly<{ [key: string]: string | number | boolean }>;

  constructor(data: { [key: string]: string | number | boolean } = {}) {
    this.entries = Object.freeze({ ...data });
  }

  getString(key: string): string {
    const v = this.entries[key];
    if (v === undefined) throw new Error(`ToolParams: missing required key "${key}"`);
    return String(v);
  }

  getNumber(key: string): number {
    const v = this.entries[key];
    if (v === undefined) throw new Error(`ToolParams: missing required key "${key}"`);
    const n = Number(v);
    if (isNaN(n)) throw new Error(`ToolParams: key "${key}" is not a number`);
    return n;
  }

  getBool(key: string): boolean {
    return Boolean(this.entries[key]);
  }

  getOptional(key: string): string | number | boolean | undefined {
    return this.entries[key];
  }

  has(key: string): boolean {
    return key in this.entries;
  }

  toObject(): { [key: string]: string | number | boolean } {
    return { ...this.entries };
  }
}

/** Typed, validated output from tool execution. */
export class ToolOutput {
  readonly data: Readonly<{ [key: string]: string | number | boolean | string[] | object }>;

  constructor(data: { [key: string]: string | number | boolean | string[] | object }) {
    this.data = Object.freeze({ ...data });
  }

  getString(key: string): string { return String(this.data[key] ?? ""); }
  getNumber(key: string): number { return Number(this.data[key] ?? 0); }
  get(key: string): string | number | boolean | string[] | object | undefined { return this.data[key]; }
  toJSON(): object { return { ...this.data }; }
  toString(): string { return JSON.stringify(this.data); }
}

/** Schema description for a tool's parameters. */
export class ToolParamSchema {
  readonly fields: ReadonlyArray<{ name: string; description: string }>;

  constructor(fields: Array<{ name: string; description: string }>) {
    this.fields = Object.freeze(fields.map((f) => Object.freeze({ ...f })));
  }

  static from(obj: { [key: string]: string }): ToolParamSchema {
    return new ToolParamSchema(Object.entries(obj).map(([name, description]) => ({ name, description })));
  }

  describe(): string {
    return this.fields.map((f) => `    ${f.name}: ${f.description}`).join("\n");
  }

  validate(params: ToolParams): void {
    for (const f of this.fields) {
      if (!params.has(f.name)) throw new Error(`Missing required parameter: "${f.name}"`);
    }
  }
}

/** Definition of a registered tool. */
export interface ToolDefinition {
  name: string;
  description: string;
  schema: ToolParamSchema;
  execute: (params: ToolParams) => ToolOutput | Promise<ToolOutput>;
}

/** Result of executing a tool. */
export class ToolResult {
  readonly tool: string;
  readonly success: boolean;
  readonly output: ToolOutput | null;
  readonly error: string | undefined;
  readonly durationMs: number;

  private constructor(tool: string, success: boolean, output: ToolOutput | null, error: string | undefined, durationMs: number) {
    this.tool = tool;
    this.success = success;
    this.output = output;
    this.error = error;
    this.durationMs = durationMs;
  }

  static ok(tool: string, output: ToolOutput, durationMs: number): ToolResult {
    return new ToolResult(tool, true, output, undefined, durationMs);
  }

  static fail(tool: string, error: string, durationMs: number): ToolResult {
    return new ToolResult(tool, false, null, error, durationMs);
  }

  static reasoning(output: string): ToolResult {
    return new ToolResult("reason", true, new ToolOutput({ value: output }), undefined, 0);
  }

  toJSON(): object {
    return { tool: this.tool, success: this.success, output: this.output?.toJSON() ?? null, error: this.error, durationMs: this.durationMs };
  }
}

/** Registry for managing and executing tools. */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): this {
    if (this.tools.has(tool.name)) throw new Error(`Tool "${tool.name}" is already registered`);
    this.tools.set(tool.name, tool);
    return this;
  }

  unregister(name: string): boolean { return this.tools.delete(name); }

  async execute(name: string, params: ToolParams = new ToolParams()): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return ToolResult.fail(name, `Unknown tool "${name}"`, 0);
    const start = Date.now();
    try {
      const output = await tool.execute(params);
      return ToolResult.ok(name, output, Date.now() - start);
    } catch (err) {
      return ToolResult.fail(name, err instanceof Error ? err.message : String(err), Date.now() - start);
    }
  }

  list(): ToolDefinition[] { return [...this.tools.values()]; }

  describe(): string {
    return this.list().map((t) => `- ${t.name}: ${t.description}\n  Parameters:\n${t.schema.describe()}`).join("\n\n");
  }

  has(name: string): boolean { return this.tools.has(name); }
  get(name: string): ToolDefinition | undefined { return this.tools.get(name); }
}
