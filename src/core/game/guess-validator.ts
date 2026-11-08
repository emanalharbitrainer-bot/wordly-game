import { checkConstraints, type Violation } from '../difficulty/difficulty-engine';
import type { DifficultyRules } from '../difficulty/difficulty-config';
import type { WordDictionary } from '../words/word-engine';
import { validateWord } from '../words/word-validator';
import type { GameSession } from './game-state';

export type GuessError =
  | { code: 'not_playing' }
  | { code: 'too_short' }
  | { code: 'not_in_dictionary' }
  | { code: 'constraint'; violation: Violation };

export type GuessValidation = { ok: true; letters: string[] } | { ok: false; error: GuessError };

/**
 * Validates the current row BEFORE it is evaluated. A rejected guess never consumes an
 * attempt: the session is left untouched and the UI shows the reason.
 */
export function validateGuess(s: GameSession, dict: WordDictionary, rules: DifficultyRules): GuessValidation {
  if (s.status !== 'PLAYING') return { ok: false, error: { code: 'not_playing' } };
  const word = validateWord(dict, s.current);
  if (!word.ok) return { ok: false, error: { code: word.reason } };
  const violation = checkConstraints(rules.constraints, s.rows, s.current);
  if (violation) return { ok: false, error: { code: 'constraint', violation } };
  return { ok: true, letters: [...s.current] };
}
