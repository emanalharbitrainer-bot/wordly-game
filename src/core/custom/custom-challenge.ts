import type { AnswerEntry, Difficulty, Lang } from '../../types';
import { getLanguageEngine } from '../localization/localization-engine';
import { SUPPORTED_LENGTHS } from '../words/word-engine';

/** A challenge produced by the AI assistant (already validated server-side, re-validated here). */
export interface CustomChallenge {
  lang: Lang;
  length: number;
  attempts: number;
  difficulty: Difficulty;
  topic?: string;
  word: string;
  display?: string;
  category: string;
  meaning: string;
  translation?: string;
  pronunciation?: string;
  example?: string;
}

export const MIN_ATTEMPTS = 3;
export const MAX_ATTEMPTS = 10;
const DIFFS: readonly Difficulty[] = ['easy', 'normal', 'hard', 'expert'];

export type ChallengeCheck =
  | { ok: true; lang: Lang; length: number; attempts: number; difficulty: Difficulty; entry: AnswerEntry; topic?: string }
  | { ok: false; reason: 'lang' | 'letters' | 'length' };

/**
 * Never trust model output blindly: the word is normalized with the game's own rules, its letters
 * must all belong to the alphabet, and its grapheme count must match a supported length.
 */
export function checkCustomChallenge(ch: Partial<CustomChallenge>): ChallengeCheck {
  if (ch.lang !== 'ar' && ch.lang !== 'en') return { ok: false, reason: 'lang' };
  const le = getLanguageEngine(ch.lang);
  const letters = le.toLetters(String(ch.word ?? ''));
  if (!letters.length || !letters.every((l) => le.alphabet.has(l))) return { ok: false, reason: 'letters' };
  if (!SUPPORTED_LENGTHS.includes(letters.length) || (ch.length !== undefined && Number(ch.length) !== letters.length)) {
    return { ok: false, reason: 'length' };
  }
  const attempts = Math.min(MAX_ATTEMPTS, Math.max(MIN_ATTEMPTS, Math.round(Number(ch.attempts) || 6)));
  const difficulty = DIFFS.includes(ch.difficulty as Difficulty) ? (ch.difficulty as Difficulty) : 'normal';
  const w = letters.join('');
  const entry: AnswerEntry = {
    w,
    d: ch.display && le.normalize(ch.display) === w ? ch.display : w,
    c: String(ch.category ?? '').slice(0, 120),
    m: String(ch.meaning ?? '').slice(0, 300),
    t: ch.translation ? String(ch.translation).slice(0, 200) : undefined,
    p: ch.pronunciation ? String(ch.pronunciation).slice(0, 120) : undefined,
    e: ch.example ? String(ch.example).slice(0, 300) : undefined,
  };
  return { ok: true, lang: ch.lang, length: letters.length, attempts, difficulty, entry, topic: ch.topic ? String(ch.topic).slice(0, 80) : undefined };
}
