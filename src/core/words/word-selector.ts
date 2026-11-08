import type { AnswerEntry } from '../../types';

export type Rng = () => number;

/**
 * Picks a secret answer while avoiding recently used words. When every word has been
 * used recently the history is ignored rather than failing, so play never blocks.
 */
export function chooseAnswer(pool: readonly AnswerEntry[], recent: readonly string[], rng: Rng = Math.random): AnswerEntry {
  if (pool.length === 0) throw new Error('Answer pool is empty');
  const recentSet = new Set(recent);
  const fresh = pool.filter((a) => !recentSet.has(a.w));
  const candidates = fresh.length > 0 ? fresh : pool;
  return candidates[Math.floor(rng() * candidates.length) % candidates.length];
}

/** How many recent answers to remember per language/level (half the pool, capped). */
export function recentWindow(poolSize: number): number {
  return Math.min(60, Math.floor(poolSize / 2));
}

/** Small deterministic PRNG (mulberry32) — used by tests and seeded shuffles. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
