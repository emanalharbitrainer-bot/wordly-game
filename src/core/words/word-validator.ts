import type { WordDictionary } from './word-engine';

export type WordValidation = { ok: true } | { ok: false; reason: 'too_short' | 'not_in_dictionary' };

/** Validates a complete row of letters against the game dictionary. */
export function validateWord(dict: WordDictionary, letters: readonly string[]): WordValidation {
  if (letters.length < dict.length) return { ok: false, reason: 'too_short' };
  if (!dict.isValidGuess(letters.join(''))) return { ok: false, reason: 'not_in_dictionary' };
  return { ok: true };
}
