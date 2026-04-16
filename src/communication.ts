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

export type MessageType = "request" | "response" | "broadcast" | "human_request" | "human_response";

/** Typed, validated payload for bus messages. */
export class MessagePayload {
  readonly data: string | number | boolean | object;

  constructor(data: string | number | boolean | object) {
    if (data === null || data === undefined) throw new Error("MessagePayload: data cannot be null/undefined");
    this.data = data;
  }

  static text(s: string): MessagePayload { return new MessagePayload(s); }
  static json(obj: object): MessagePayload { return new MessagePayload(obj); }

  asString(): string { return typeof this.data === "string" ? this.data : JSON.stringify(this.data); }
  asObject(): object { return typeof this.data === "object" ? this.data : { value: this.data }; }
  toJSON(): string | number | boolean | object { return this.data; }
}

/** A message on the communication bus. */
export class Message {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly type: MessageType;
  readonly channel: string;
  readonly payload: MessagePayload;
  readonly inReplyTo: string | undefined;
  readonly timestamp: number;

  constructor(init: { from: string; to: string; type: MessageType; channel: string; payload: MessagePayload; inReplyTo?: string }) {
    this.id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.from = init.from;
    this.to = init.to;
    this.type = init.type;
    this.channel = init.channel;
    this.payload = init.payload;
    this.inReplyTo = init.inReplyTo;
    this.timestamp = Date.now();
  }
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
  async send(init: { from: string; to: string; type: MessageType; channel: string; payload: MessagePayload }): Promise<void> {
    const msg = new Message(init);
    this.messageLog.push(msg);
    await this.dispatch(msg);
  }

  /** Send a request and wait for a response (with timeout). */
  async request(
    init: { from: string; to: string; channel: string; payload: MessagePayload },
    timeoutMs = 30_000
  ): Promise<Message> {
    const msg = new Message({ ...init, type: "request" });
    this.messageLog.push(msg);

    return new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(msg.id);
        reject(new Error(`Request ${msg.id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pendingRequests.set(msg.id, { resolve, timer });
      this.dispatch(msg);
    });
  }

  /** Reply to a request. */
  async reply(original: Message, payload: MessagePayload, from: string): Promise<void> {
    const response = new Message({
      from,
      to: original.from,
      type: "response",
      channel: original.channel,
      payload,
      inReplyTo: original.id,
    });
    this.messageLog.push(response);

    const pending = this.pendingRequests.get(original.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(original.id);
      pending.resolve(response);
    }
    await this.dispatch(response);
  }

  /** Request human input. */
  async requestHuman(from: string, question: string): Promise<string> {
    const msg = new Message({
      from,
      to: "human",
      type: "human_request",
      channel: "human",
      payload: MessagePayload.text(question),
    });
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
