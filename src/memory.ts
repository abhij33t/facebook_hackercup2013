/**
 * Layer 2: Three-tier Memory System
 *
 * Mirrors how humans (and LLMs) handle information:
 *   - WorkingMemory  → like attention / context window (small, fast, current focus)
 *   - EpisodicMemory → like training examples (past experiences with outcomes)
 *   - SemanticMemory  → like learned weights (facts, knowledge, long-term)
 *
 * Scaling property: more episodes → better decisions; more knowledge → broader capability.
 */

// ── Working Memory (the "context window") ──────────────────────────

export class WorkingMemory {
  private slots = new Map<string, unknown>();
  private maxSlots: number;

  constructor(maxSlots = 50) {
    this.maxSlots = maxSlots;
  }

  set(key: string, value: unknown): void {
    if (this.slots.size >= this.maxSlots && !this.slots.has(key)) {
      // Evict oldest entry (FIFO) — like context window overflow
      const oldest = this.slots.keys().next().value!;
      this.slots.delete(oldest);
    }
    this.slots.set(key, value);
  }

  get<T = unknown>(key: string): T | undefined {
    return this.slots.get(key) as T | undefined;
  }

  has(key: string): boolean {
    return this.slots.has(key);
  }

  clear(): void {
    this.slots.clear();
  }

  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.slots);
  }
}

// ── Episodic Memory (learning from experience) ─────────────────────

export interface Episode {
  id: string;
  timestamp: number;
  situation: string;      // what was the context
  action: string;         // what did the agent do
  outcome: string;        // what happened
  reward: number;         // -1 to 1: how good was the outcome
  tags: string[];         // for retrieval
}

export class EpisodicMemory {
  private episodes: Episode[] = [];
  private maxEpisodes: number;

  constructor(maxEpisodes = 1000) {
    this.maxEpisodes = maxEpisodes;
  }

  /** Record a new experience. */
  record(episode: Omit<Episode, "id" | "timestamp">): Episode {
    const full: Episode = {
      ...episode,
      id: `ep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    };
    this.episodes.push(full);
    // Evict low-reward episodes when full — keep the most useful memories
    if (this.episodes.length > this.maxEpisodes) {
      this.episodes.sort((a, b) => b.reward - a.reward);
      this.episodes = this.episodes.slice(0, this.maxEpisodes);
    }
    return full;
  }

  /** Find relevant past experiences by tag overlap + text match. */
  recall(query: string, tags: string[] = [], limit = 5): Episode[] {
    const queryLower = query.toLowerCase();
    const scored = this.episodes.map((ep) => {
      let score = 0;
      // Text relevance
      if (ep.situation.toLowerCase().includes(queryLower)) score += 2;
      if (ep.action.toLowerCase().includes(queryLower)) score += 1;
      // Tag overlap
      for (const t of tags) {
        if (ep.tags.includes(t)) score += 3;
      }
      // Recency bias
      score += 1 / (1 + (Date.now() - ep.timestamp) / 3_600_000);
      // Reward weight — prefer learning from good outcomes
      score += ep.reward;
      return { ep, score };
    });
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.ep);
  }

  /** Get all episodes (for serialization / export). */
  all(): ReadonlyArray<Episode> {
    return this.episodes;
  }

  size(): number {
    return this.episodes.length;
  }
}

// ── Semantic Memory (knowledge base) ───────────────────────────────

export interface Fact {
  key: string;
  value: string;
  confidence: number;   // 0–1
  source: string;
  updatedAt: number;
}

export class SemanticMemory {
  private facts = new Map<string, Fact>();

  /** Store or update a fact. Higher-confidence facts overwrite lower. */
  store(key: string, value: string, confidence: number, source: string): void {
    const existing = this.facts.get(key);
    if (!existing || confidence >= existing.confidence) {
      this.facts.set(key, { key, value, confidence, source, updatedAt: Date.now() });
    }
  }

  /** Retrieve a fact by exact key. */
  retrieve(key: string): Fact | undefined {
    return this.facts.get(key);
  }

  /** Search facts by substring match on key or value. */
  search(query: string, limit = 10): Fact[] {
    const q = query.toLowerCase();
    return [...this.facts.values()]
      .filter((f) => f.key.toLowerCase().includes(q) || f.value.toLowerCase().includes(q))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  /** Get all facts. */
  all(): ReadonlyArray<Fact> {
    return [...this.facts.values()];
  }

  size(): number {
    return this.facts.size;
  }
}

// ── Unified Memory Facade ──────────────────────────────────────────

export class Memory {
  readonly working: WorkingMemory;
  readonly episodic: EpisodicMemory;
  readonly semantic: SemanticMemory;

  constructor(opts?: { workingSlots?: number; maxEpisodes?: number }) {
    this.working = new WorkingMemory(opts?.workingSlots);
    this.episodic = new EpisodicMemory(opts?.maxEpisodes);
    this.semantic = new SemanticMemory();
  }
}
