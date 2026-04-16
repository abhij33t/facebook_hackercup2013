/**
 * Layer 5: Task Manager — fully typed with validation.
 */

export type TaskStatus = "pending" | "in_progress" | "blocked" | "completed" | "failed";
export type TaskPriority = "critical" | "high" | "medium" | "low";

const PRIORITY_ORDER: Readonly<Record<TaskPriority, number>> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Typed metadata attached to a task — carries tool routing info. */
export class TaskMetadata {
  readonly tool: string | undefined;
  readonly toolParams: Readonly<{ [key: string]: string | number | boolean }> | undefined;
  readonly depIndices: ReadonlyArray<number> | undefined;

  constructor(init?: { tool?: string; toolParams?: { [key: string]: string | number | boolean }; depIndices?: number[] }) {
    this.tool = init?.tool;
    this.toolParams = init?.toolParams ? Object.freeze({ ...init.toolParams }) : undefined;
    this.depIndices = init?.depIndices ? Object.freeze([...init.depIndices]) : undefined;
  }

  static empty(): TaskMetadata { return new TaskMetadata(); }

  hasTool(): boolean { return this.tool !== undefined; }
}

/** Typed result of a completed task. */
export class TaskResult {
  readonly value: string | number | object;
  readonly subtaskResults: ReadonlyArray<TaskResult> | undefined;

  constructor(value: string | number | object, subtaskResults?: TaskResult[]) {
    this.value = value;
    this.subtaskResults = subtaskResults ? Object.freeze([...subtaskResults]) : undefined;
  }

  toString(): string {
    return typeof this.value === "object" ? JSON.stringify(this.value) : String(this.value);
  }
}

/** A managed task with full lifecycle tracking. */
export class Task {
  readonly id: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string | undefined;
  parentId: string | undefined;
  dependencies: string[];
  result: TaskResult | undefined;
  error: string | undefined;
  readonly createdAt: number;
  updatedAt: number;
  readonly metadata: TaskMetadata;

  constructor(init: {
    id: string; description: string; priority: TaskPriority;
    assignee?: string; parentId?: string; dependencies: string[];
    metadata: TaskMetadata;
  }) {
    this.id = init.id;
    this.description = init.description;
    this.status = "pending";
    this.priority = init.priority;
    this.assignee = init.assignee;
    this.parentId = init.parentId;
    this.dependencies = init.dependencies;
    this.metadata = init.metadata;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }
}

/** Input for creating a new task. */
export interface TaskCreate {
  description: string;
  priority?: TaskPriority;
  assignee?: string;
  parentId?: string;
  dependencies?: string[];
  metadata?: TaskMetadata;
}

/** Manages task lifecycle: creation, priority, dependencies, delegation. */
export class TaskManager {
  private tasks = new Map<string, Task>();

  add(input: TaskCreate): Task {
    const task = new Task({
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      description: input.description,
      priority: input.priority ?? "medium",
      assignee: input.assignee,
      parentId: input.parentId,
      dependencies: input.dependencies ?? [],
      metadata: input.metadata ?? TaskMetadata.empty(),
    });
    this.tasks.set(task.id, task);
    return task;
  }

  decompose(parentId: string, subtasks: TaskCreate[]): Task[] {
    const parent = this.tasks.get(parentId);
    if (!parent) throw new Error(`Task "${parentId}" not found`);
    return subtasks.map((st) => this.add({ ...st, parentId }));
  }

  next(assignee?: string): Task | undefined {
    const candidates = [...this.tasks.values()]
      .filter((t) => t.status === "pending")
      .filter((t) => !assignee || !t.assignee || t.assignee === assignee)
      .filter((t) => this.depsCompleted(t));
    candidates.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    return candidates[0];
  }

  start(taskId: string, assignee?: string): Task {
    const task = this.mustGet(taskId);
    task.status = "in_progress";
    if (assignee) task.assignee = assignee;
    task.updatedAt = Date.now();
    return task;
  }

  complete(taskId: string, result?: TaskResult): Task {
    const task = this.mustGet(taskId);
    task.status = "completed";
    task.result = result;
    task.updatedAt = Date.now();
    if (task.parentId) {
      const siblings = this.subtasks(task.parentId);
      if (siblings.every((s) => s.status === "completed")) {
        const combined = new TaskResult("completed", siblings.map((s) => s.result).filter((r): r is TaskResult => !!r));
        this.complete(task.parentId, combined);
      }
    }
    return task;
  }

  fail(taskId: string, error: string): Task {
    const task = this.mustGet(taskId);
    task.status = "failed";
    task.error = error;
    task.updatedAt = Date.now();
    return task;
  }

  delegate(taskId: string, assignee: string): Task {
    const task = this.mustGet(taskId);
    task.assignee = assignee;
    task.updatedAt = Date.now();
    return task;
  }

  subtasks(parentId: string): Task[] {
    return [...this.tasks.values()].filter((t) => t.parentId === parentId);
  }

  get(taskId: string): Task | undefined { return this.tasks.get(taskId); }

  list(filter?: { status?: TaskStatus; assignee?: string }): Task[] {
    let result = [...this.tasks.values()];
    if (filter?.status) result = result.filter((t) => t.status === filter.status);
    if (filter?.assignee) result = result.filter((t) => t.assignee === filter.assignee);
    return result.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }

  stats(): Record<TaskStatus, number> {
    const counts: Record<string, number> = { pending: 0, in_progress: 0, blocked: 0, completed: 0, failed: 0 };
    for (const t of this.tasks.values()) counts[t.status]++;
    return counts as Record<TaskStatus, number>;
  }

  private depsCompleted(task: Task): boolean {
    return task.dependencies.every((depId) => {
      const dep = this.tasks.get(depId);
      return dep && dep.status === "completed";
    });
  }

  private mustGet(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task "${taskId}" not found`);
    return task;
  }
}
