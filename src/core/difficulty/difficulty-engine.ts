import type { GuessRow } from '../../types';
import type { ConstraintLevel } from './difficulty-config';

/** Everything the player has provably learned from previous rows. */
export interface Knowledge {
  /** position → letter known to be there (green). */
  fixed: Map<number, string>;
  /** letter → minimum number of occurrences in the secret. */
  minCount: Map<string, number>;
  /** letter → exact maximum (known when a copy of the letter was marked absent). */
  maxCount: Map<string, number>;
  /** letter → positions where it was yellow (so it cannot be there). */
  forbidden: Map<string, Set<number>>;
}

export function deriveKnowledge(rows: readonly GuessRow[]): Knowledge {
  const k: Knowledge = { fixed: new Map(), minCount: new Map(), maxCount: new Map(), forbidden: new Map() };
  for (const row of rows) {
    const hits = new Map<string, number>();
    const hasAbsent = new Set<string>();
    row.letters.forEach((letter, i) => {
      const r = row.results[i];
      if (r === 'correct') k.fixed.set(i, letter);
      if (r === 'present') {
        if (!k.forbidden.has(letter)) k.forbidden.set(letter, new Set());
        k.forbidden.get(letter)!.add(i);
      }
      if (r === 'correct' || r === 'present') hits.set(letter, (hits.get(letter) ?? 0) + 1);
      else hasAbsent.add(letter);
    });
    for (const [letter, n] of hits) k.minCount.set(letter, Math.max(k.minCount.get(letter) ?? 0, n));
    for (const letter of hasAbsent) {
      const exact = hits.get(letter) ?? 0;
      const prev = k.maxCount.get(letter);
      k.maxCount.set(letter, prev === undefined ? exact : Math.min(prev, exact));
    }
  }
  return k;
}

export type Violation =
  | { code: 'must_keep_correct'; letter: string; position: number }
  | { code: 'must_include'; letter: string; count: number }
  | { code: 'must_move_present'; letter: string; position: number }
  | { code: 'excluded_letter'; letter: string }
  | { code: 'too_many'; letter: string; count: number };

/**
 * Checks a candidate guess against the constraint level. Returns the FIRST violation
 * (in a stable, player-friendly order) or null when the guess is allowed.
 */
export function checkConstraints(level: ConstraintLevel, rows: readonly GuessRow[], guess: readonly string[]): Violation | null {
  if (level === 'none' || rows.length === 0) return null;
  const k = deriveKnowledge(rows);

  for (const [position, letter] of [...k.fixed].sort((a, b) => a[0] - b[0])) {
    if (guess[position] !== letter) return { code: 'must_keep_correct', letter, position };
  }
  const counts = new Map<string, number>();
  for (const l of guess) counts.set(l, (counts.get(l) ?? 0) + 1);
  for (const [letter, min] of k.minCount) {
    if ((counts.get(letter) ?? 0) < min) return { code: 'must_include', letter, count: min };
  }
  for (const [letter, positions] of k.forbidden) {
    for (const p of [...positions].sort((a, b) => a - b)) {
      if (guess[p] === letter) return { code: 'must_move_present', letter, position: p };
    }
  }
  if (level === 'expert') {
    for (const [letter, max] of k.maxCount) {
      const n = counts.get(letter) ?? 0;
      if (max === 0 && n > 0) return { code: 'excluded_letter', letter };
      if (n > max) return { code: 'too_many', letter, count: max };
    }
  }
  return null;
}
