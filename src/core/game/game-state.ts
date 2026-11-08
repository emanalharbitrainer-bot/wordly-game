import type { AnswerEntry, Difficulty, GameMode, GameStatus, GuessRow, HintReveal, Lang } from '../../types';

/** A full, serializable game session. Pure data — no methods, safe to persist. */
export interface GameSession {
  id: string;
  mode: GameMode;
  difficulty: Difficulty;
  lang: Lang;
  length: number;
  maxAttempts: number;
  status: GameStatus;
  rows: GuessRow[];
  current: string[];
  /** Secret for local modes. Never present for the daily challenge (server-side only). */
  secret?: AnswerEntry;
  /** Answer revealed by the server once a daily game is over. */
  revealedAnswer?: string;
  /** Full answer entry for the post-round learning card (local secret or server reveal). */
  reveal?: AnswerEntry;
  dailyDate?: string;
  dailyNumber?: number;
  /** Topic of an AI custom challenge (display only). */
  topic?: string;
  /** Word pack this round belongs to (mode "pack"). */
  packId?: string;
  /** Daily / archive played in hard mode (server-enforced). */
  hard?: boolean;
  hints: HintReveal[];
  startedAt: string;
  finishedAt?: string;
  /** True once the result has been sent to statistics (prevents double counting). */
  resultRecorded: boolean;
}

export const FINISHED_STATUSES: ReadonlySet<GameStatus> = new Set(['WON', 'LOST', 'COMPLETED']);

export function isFinished(s: Pick<GameSession, 'status'>): boolean {
  return FINISHED_STATUSES.has(s.status);
}

export function attemptsLeft(s: Pick<GameSession, 'maxAttempts' | 'rows'>): number {
  return Math.max(0, s.maxAttempts - s.rows.length);
}

/** Allowed status transitions — anything else is rejected by the session reducers. */
export const TRANSITIONS: Readonly<Record<GameStatus, readonly GameStatus[]>> = {
  IDLE: ['PLAYING'],
  PLAYING: ['PAUSED', 'WON', 'LOST'],
  PAUSED: ['PLAYING'],
  WON: ['COMPLETED'],
  LOST: ['COMPLETED'],
  COMPLETED: [],
};

export function canTransition(from: GameStatus, to: GameStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
