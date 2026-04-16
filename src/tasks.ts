/**
 * Layer 5: Task Manager
 *
 * Humans decompose big problems into smaller ones. This module does the same:
 * tasks have priorities, dependencies, can be delegated to other agents,
 * and track their own lifecycle.
 *
 * Scaling property: deeper task decomposition → harder problems solved.
 * A task can spawn sub-tasks, which can spawn sub-sub-tasks, recursively.
 */

export type TaskStatus = "pending" | "in_progress" | "blocked" | "completed" | "failed";
export type TaskPriority = "critical" | "high" | "medium" | "low";

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee?: string;        // agent ID or "human"
  parentId?: string;        // for sub-task hierarchy
  dependencies: string[];   // task IDs that must complete first
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

export interface TaskCreate {
  description: string;
  priority?: TaskPriority;
  assignee?: string;
  parentId?: string;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
}

export class TaskManager {
  private tasks = new Map<string, Task>();

  /** Create a new task. */
  add(input: TaskCreate): Task {
    const task: Task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      description: input.description,
      status: "pending",
      priority: input.priority ?? "medium",
      assignee: input.assignee,
      parentId: input.parentId,
      dependencies: input.dependencies ?? [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: input.metadata ?? {},
    };
    this.tasks.set(task.id, task);
    return task;
  }

  /** Decompose a task into sub-tasks. Returns the sub-tasks. */
  decompose(parentId: string, subtasks: TaskCreate[]): Task[] {
    const parent = this.tasks.get(parentId);
    if (!parent) throw new Error(`Task "${parentId}" not found`);
    return subtasks.map((st) => this.add({ ...st, parentId }));
  }

  /** Get the next actionable task (highest priority, all deps met). */
  next(assignee?: string): Task | undefined {
    const candidates = [...this.tasks.values()]
      .filter((t) => t.status === "pending")
      .filter((t) => !assignee || !t.assignee || t.assignee === assignee)
      .filter((t) => this.depsCompleted(t));

    candidates.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    return candidates[0];
  }

  /** Start working on a task. */
  start(taskId: string, assignee?: string): Task {
    return this.update(taskId, { status: "in_progress", assignee });
  }

  /** Complete a task with a result. */
  complete(taskId: string, result?: unknown): Task {
    const task = this.update(taskId, { status: "completed", result });
    // Check if all sibling sub-tasks are done → auto-complete parent
    if (task.parentId) {
      const siblings = this.subtasks(task.parentId);
      if (siblings.every((s) => s.status === "completed")) {
        this.complete(task.parentId, { subtaskResults: siblings.map((s) => s.result) });
      }
    }
    return task;
  }

  /** Mark a task as failed. */
  fail(taskId: string, error: string): Task {
    return this.update(taskId, { status: "failed", error });
  }

  /** Delegate a task to another agent. */
  delegate(taskId: string, assignee: string): Task {
    return this.update(taskId, { assignee });
  }

  /** Get sub-tasks of a parent. */
  subtasks(parentId: string): Task[] {
    return [...this.tasks.values()].filter((t) => t.parentId === parentId);
  }

  /** Get a task by ID. */
  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /** Get all tasks matching a filter. */
  list(filter?: { status?: TaskStatus; assignee?: string }): Task[] {
    let tasks = [...this.tasks.values()];
    if (filter?.status) tasks = tasks.filter((t) => t.status === filter.status);
    if (filter?.assignee) tasks = tasks.filter((t) => t.assignee === filter.assignee);
    return tasks.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }

  /** Summary stats. */
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

  private update(taskId: string, fields: Partial<Task>): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task "${taskId}" not found`);
    Object.assign(task, fields, { updatedAt: Date.now() });
    return task;
  }
}
