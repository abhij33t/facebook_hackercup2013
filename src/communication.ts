/**
 * Layer 4: Communication Bus
 *
 * Agents need to talk — to each other, to humans, to external systems.
 * This is the nervous system that connects everything.
 *
 * Patterns supported:
 *   - Fire-and-forget (broadcast)
 *   - Request/response (ask another agent and wait)
 *   - Human-in-the-loop (pause until a human responds)
 *   - Channels (topic-based routing)
 *
 * Scaling property: more agents on the bus → more collaborative problem solving,
 * like scaling model size enables more emergent behavior.
 */

export interface Message {
  id: string;
  from: string;
  to: string;           // agent ID, "human", or channel name
  type: "request" | "response" | "broadcast" | "human_request" | "human_response";
  channel: string;
  payload: unknown;
  inReplyTo?: string;    // links response to request
  timestamp: number;
}

type MessageHandler = (message: Message) => void | Promise<void>;

export class MessageBus {
  private handlers = new Map<string, Set<MessageHandler>>();
  private pendingRequests = new Map<string, {
    resolve: (msg: Message) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private messageLog: Message[] = [];
  private humanInputQueue: ((input: string) => void)[] = [];

  /** Subscribe an agent (or any listener) to a channel. */
  subscribe(channel: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
    }
    this.handlers.get(channel)!.add(handler);
    // Return unsubscribe function
    return () => this.handlers.get(channel)?.delete(handler);
  }

  /** Send a fire-and-forget message. */
  async send(msg: Omit<Message, "id" | "timestamp">): Promise<void> {
    const full: Message = {
      ...msg,
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    };
    this.messageLog.push(full);
    await this.dispatch(full);
  }

  /** Send a request and wait for a response (with timeout). */
  async request(
    msg: Omit<Message, "id" | "timestamp" | "type">,
    timeoutMs = 30_000
  ): Promise<Message> {
    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const full: Message = { ...msg, id, type: "request", timestamp: Date.now() };
    this.messageLog.push(full);

    return new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pendingRequests.set(id, { resolve, timer });
      this.dispatch(full);
    });
  }

  /** Reply to a request. */
  async reply(original: Message, payload: unknown, from: string): Promise<void> {
    const response: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      from,
      to: original.from,
      type: "response",
      channel: original.channel,
      payload,
      inReplyTo: original.id,
      timestamp: Date.now(),
    };
    this.messageLog.push(response);

    // Resolve pending request if any
    const pending = this.pendingRequests.get(original.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(original.id);
      pending.resolve(response);
    }
    await this.dispatch(response);
  }

  /**
   * Request human input. Returns a promise that resolves when
   * a human provides input via `provideHumanInput()`.
   */
  async requestHuman(from: string, question: string): Promise<string> {
    const msg: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      from,
      to: "human",
      type: "human_request",
      channel: "human",
      payload: question,
      timestamp: Date.now(),
    };
    this.messageLog.push(msg);
    await this.dispatch(msg);

    return new Promise<string>((resolve) => {
      this.humanInputQueue.push(resolve);
    });
  }

  /** Human provides input (called externally, e.g. from CLI or UI). */
  provideHumanInput(input: string): void {
    const resolver = this.humanInputQueue.shift();
    if (resolver) resolver(input);
  }

  /** Get recent messages on a channel (for agent context). */
  history(channel?: string, limit = 20): Message[] {
    const msgs = channel
      ? this.messageLog.filter((m) => m.channel === channel)
      : this.messageLog;
    return msgs.slice(-limit);
  }

  /** Check if there are pending human requests. */
  hasPendingHumanRequests(): boolean {
    return this.humanInputQueue.length > 0;
  }

  private async dispatch(msg: Message): Promise<void> {
    // Deliver to channel subscribers
    const handlers = this.handlers.get(msg.channel);
    if (handlers) {
      for (const handler of handlers) {
        await handler(msg);
      }
    }
    // Also deliver to "all" channel
    const allHandlers = this.handlers.get("*");
    if (allHandlers) {
      for (const handler of allHandlers) {
        await handler(msg);
      }
    }
  }
}
