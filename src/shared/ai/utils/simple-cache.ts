export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_MAX_ENTRIES = 1000;

export class SimpleCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(private readonly maxEntries = DEFAULT_MAX_ENTRIES) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    this.store.delete(key);
    if (this.store.size >= this.maxEntries) this.evict();
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  get size(): number {
    return this.store.size;
  }

  private evict(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
    while (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}
