import type { AnswerEntry, Difficulty, GameMode, GameStatus, HintReveal, Lang, LetterResult } from '../../types';
import { canTransition, type GameSession } from './game-state';
import { isWinningResult } from './letter-evaluator';

/**
 * Pure reducers for a game session. Each returns a NEW session (or the same object when
 * the action is not allowed), which keeps the engine predictable and trivially testable.
 */
export interface NewSessionOptions {
  id: string;
  mode: GameMode;
  difficulty: Difficulty;
  lang: Lang;
  length: number;
  maxAttempts: number;
  secret?: AnswerEntry;
  dailyDate?: string;
  dailyNumber?: number;
  now?: string;
}

export function createSession(o: NewSessionOptions): GameSession {
  return {
    id: o.id,
    mode: o.mode,
    difficulty: o.difficulty,
    lang: o.lang,
    length: o.length,
    maxAttempts: o.maxAttempts,
    status: 'PLAYING',
    rows: [],
    current: [],
    secret: o.secret,
    dailyDate: o.dailyDate,
    dailyNumber: o.dailyNumber,
    hints: [],
    startedAt: o.now ?? new Date().toISOString(),
    resultRecorded: false,
  };
}

function transition(s: GameSession, to: GameStatus): GameSession {
  return canTransition(s.status, to) ? { ...s, status: to } : s;
}

export function typeLetter(s: GameSession, letter: string): GameSession {
  if (s.status !== 'PLAYING' || s.current.length >= s.length) return s;
  return { ...s, current: [...s.current, letter] };
}

export function deleteLetter(s: GameSession): GameSession {
  if (s.status !== 'PLAYING' || s.current.length === 0) return s;
  return { ...s, current: s.current.slice(0, -1) };
}

/** Appends an evaluated row and resolves win/loss. Ignored unless the game is PLAYING. */
export function applyEvaluation(s: GameSession, letters: readonly string[], results: readonly LetterResult[], now = new Date().toISOString()): GameSession {
  if (s.status !== 'PLAYING' || s.rows.length >= s.maxAttempts) return s;
  if (letters.length !== s.length || results.length !== s.length) throw new Error('Row length mismatch');
  const rows = [...s.rows, { letters: [...letters], results: [...results] }];
  let next: GameSession = { ...s, rows, current: [] };
  if (isWinningResult(results)) next = { ...transition(next, 'WON'), finishedAt: now };
  else if (rows.length >= s.maxAttempts) next = { ...transition(next, 'LOST'), finishedAt: now };
  return next;
}

export const pause = (s: GameSession) => transition(s, 'PAUSED');
export const resume = (s: GameSession) => transition(s, 'PLAYING');
export const complete = (s: GameSession) => transition(s, 'COMPLETED');
export const markRecorded = (s: GameSession): GameSession => ({ ...s, resultRecorded: true });

export function addHint(s: GameSession, hint: HintReveal): GameSession {
  if (s.status !== 'PLAYING') return s;
  return { ...s, hints: [...s.hints, hint] };
}
