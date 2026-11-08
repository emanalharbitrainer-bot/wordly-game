import type { GuessRow, KeyState, LetterResult } from '../../types';

const PRIORITY: Record<LetterResult, number> = { correct: 3, present: 2, absent: 1 };
const FROM_RESULT: Record<LetterResult, KeyState> = { correct: 'correct', present: 'present', absent: 'absent' };

/**
 * Computes the state of every letter that has been tried.
 * Priority: CORRECT > PRESENT > ABSENT, so a letter shown grey earlier and green later
 * becomes green. A letter is only ever `disabled` (eliminated) when keyboard elimination
 * is on AND it was never marked correct/present in any row — i.e. it is provably absent.
 * A duplicate copy marked absent (e.g. the second L of ALLEY against APPLE) therefore
 * never eliminates a letter that exists in the word.
 */
export function computeKeyStates(rows: readonly GuessRow[], eliminateAbsent: boolean): Map<string, KeyState> {
  const best = new Map<string, LetterResult>();
  for (const row of rows) {
    row.letters.forEach((letter, i) => {
      const r = row.results[i];
      const prev = best.get(letter);
      if (!prev || PRIORITY[r] > PRIORITY[prev]) best.set(letter, r);
    });
  }
  const states = new Map<string, KeyState>();
  for (const [letter, r] of best) {
    states.set(letter, r === 'absent' && eliminateAbsent ? 'disabled' : FROM_RESULT[r]);
  }
  return states;
}

export function keyStateOf(states: Map<string, KeyState>, letter: string): KeyState {
  return states.get(letter) ?? 'unused';
}
