import type { Evaluator } from '../../core/game/game-engine';
import type { Lang, LetterResult } from '../../types';

/**
 * Client for the server-authoritative daily challenge (Supabase Postgres RPC).
 * Only the public, row-level-secured "publishable" key is used here — it can call the two
 * whitelisted functions and nothing else. No secret keys ship to the browser.
 */
const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export interface DailyAnswer {
  word: string;
  display: string;
  category: string;
  meaning: string;
  translation: string | null;
  pronunciation: string | null;
  example: string | null;
  root?: string | null;
}

export interface DailyState {
  date: string;
  number: number;
  length: number;
  max_attempts: number;
  guesses: string[];
  patterns: string[];
  status: 'PLAYING' | 'WON' | 'LOST';
  answer: DailyAnswer | null;
  /** Played in hard mode (server-enforced). */
  hard?: boolean;
  /** A past day opened from the archive. */
  archive?: boolean;
}

export interface DailyGuessResponse {
  pattern: string;
  status: 'PLAYING' | 'WON' | 'LOST';
  attempt: number;
  answer: DailyAnswer | null;
  /** League points awarded when today's game ended (null for archive days / unfinished). */
  points?: number | null;
}

export class DailyUnavailableError extends Error {}

export function isDailyConfigured(): boolean {
  return Boolean(URL && KEY);
}

async function rpc<T>(fn: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (!URL || !KEY) throw new DailyUnavailableError('Daily challenge backend is not configured');
  let res: Response;
  try {
    res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    throw new DailyUnavailableError(e instanceof Error ? e.message : 'network error');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Daily challenge request failed (${res.status}) ${text.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

export function fetchDailyState(playerId: string, lang: Lang, signal?: AbortSignal) {
  return rpc<DailyState>('wordly_daily_state', { p_player: playerId, p_lang: lang }, signal);
}

export function submitDailyGuess(playerId: string, lang: Lang, guess: string) {
  return rpc<DailyGuessResponse>('wordly_daily_guess', { p_player: playerId, p_lang: lang, p_guess: guess });
}

const CODE: Record<string, LetterResult> = { C: 'correct', P: 'present', A: 'absent' };

export function decodePattern(pattern: string): LetterResult[] {
  return [...pattern].map((c) => {
    const r = CODE[c];
    if (!r) throw new Error(`Bad pattern from server: ${pattern}`);
    return r;
  });
}

/** Evaluator that asks the server; the secret word never reaches the browser mid-game. */
export function submitArchiveGuess(playerId: string, lang: Lang, date: string, guess: string) {
  return rpc<DailyGuessResponse>('wordly_archive_guess', { p_player: playerId, p_lang: lang, p_date: date, p_guess: guess });
}

/**
 * Evaluator that asks the server; the secret word never reaches the browser mid-game.
 * With `archiveDate` it plays that past day instead of today's challenge.
 */
export class RemoteDailyEvaluator implements Evaluator {
  lastAnswer: DailyAnswer | null = null;
  lastPoints: number | null = null;
  constructor(
    private readonly playerId: string,
    private readonly lang: Lang,
    private readonly archiveDate?: string,
  ) {}
  async evaluate(letters: readonly string[]) {
    const guess = letters.join('');
    const res = this.archiveDate ? await submitArchiveGuess(this.playerId, this.lang, this.archiveDate, guess) : await submitDailyGuess(this.playerId, this.lang, guess);
    this.lastAnswer = res.answer;
    this.lastPoints = res.points ?? null;
    return { results: decodePattern(res.pattern), answer: res.answer?.word };
  }
}
