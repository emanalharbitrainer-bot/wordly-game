/**
 * Thin, defensive wrapper around localStorage.
 * - Never throws (private mode, quota, disabled storage all degrade to in-memory).
 * - Every read goes through a validator, so corrupted or tampered data is discarded
 *   instead of crashing the game.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class MemoryStore implements KeyValueStore {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

function detectStore(): KeyValueStore {
  try {
    const ls = globalThis.localStorage;
    const probe = '__wordly_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return new MemoryStore();
  }
}

export type Validator<T> = (value: unknown) => value is T;

const PREFIX = 'wordly:v1:';

export class JsonStorage {
  constructor(private readonly store: KeyValueStore = detectStore()) {}

  read<T>(key: string, validate: Validator<T>, fallback: T): T {
    try {
      const raw = this.store.getItem(PREFIX + key);
      if (raw == null) return fallback;
      const parsed: unknown = JSON.parse(raw);
      return validate(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  write(key: string, value: unknown): void {
    try {
      this.store.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* storage full or unavailable — the game keeps working in memory */
    }
  }

  remove(key: string): void {
    try {
      this.store.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
  }
}

export { MemoryStore };
