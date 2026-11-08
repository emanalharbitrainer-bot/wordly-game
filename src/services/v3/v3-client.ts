import type { DayStats } from '../../core/league/league';
import type { Lang } from '../../types';
import type { DailyAnswer, DailyState } from '../daily/daily-client';

/**
 * WORDLY 3.0 server calls (league, groups, archive, hard mode, day stats, metrics).
 * Same rules as the daily client: only the publishable key, only whitelisted RPCs,
 * and the server decides everything that affects other players.
 */
const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export class V3Error extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/** Maps a Postgres exception text to a short stable code the UI translates. */
function codeOf(text: string): string {
  const known = ['hard mode locked', 'hard mode violation', 'join league first', 'group not found', 'group full', 'too many groups today', 'too many groups', 'not a member', 'invalid name', 'name required', 'not finished', 'invalid date', 'game over'];
  const hit = known.find((k) => text.includes(k));
  return hit ? hit.replace(/ /g, '_') : 'server';
}

async function rpc<T>(fn: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (!URL || !KEY) throw new V3Error('backend not configured', 'offline');
  let res: Response;
  try {
    res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      keepalive: fn === 'wordly_track',
    });
  } catch (e) {
    throw new V3Error(e instanceof Error ? e.message : 'network error', 'offline');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new V3Error(text.slice(0, 160), codeOf(text));
  }
  const raw = await res.text();
  return (raw ? JSON.parse(raw) : null) as T;
}

// ───────── archive + hard mode + stats ─────────
export interface ArchiveDay {
  date: string;
  number: number;
  status: 'NEW' | 'PLAYING' | 'WON' | 'LOST';
  attempts: number;
  hard: boolean;
}

export interface GuessResponse {
  pattern: string;
  status: 'PLAYING' | 'WON' | 'LOST';
  attempt: number;
  hard: boolean;
  points: number | null;
  answer: (DailyAnswer & { root?: string | null }) | null;
}

export const archiveList = (player: string, lang: Lang, signal?: AbortSignal) => rpc<ArchiveDay[]>('wordly_archive_list', { p_player: player, p_lang: lang }, signal);
export const archiveState = (player: string, lang: Lang, date: string) => rpc<DailyState>('wordly_archive_state', { p_player: player, p_lang: lang, p_date: date });
export const archiveGuess = (player: string, lang: Lang, date: string, guess: string) =>
  rpc<GuessResponse>('wordly_archive_guess', { p_player: player, p_lang: lang, p_date: date, p_guess: guess });
export const setHard = (player: string, lang: Lang, date: string, hard: boolean) =>
  rpc<DailyState>('wordly_daily_set_hard', { p_player: player, p_lang: lang, p_date: date, p_hard: hard });
export const dayStats = (player: string, lang: Lang, date: string) => rpc<DayStats>('wordly_daily_stats', { p_player: player, p_lang: lang, p_date: date });

// ───────── league ─────────
export interface BoardRow {
  rank: number;
  handle: string;
  name: string;
  avatar: string;
  color: string;
  points: number;
  wins: number;
  games?: number;
  tier?: number;
  me: boolean;
}

export interface LastWeek {
  week_start: string;
  tier: number;
  rank: number;
  outcome: 'up' | 'stay' | 'down';
  points: number;
  reward: boolean;
  claimed: boolean;
}

export type LeagueState =
  | { member: false; week_start: string; week_end: string; points: number }
  | {
      member: true;
      me: { handle: string; name: string; avatar: string; color: string; tier: number };
      week_start: string;
      week_end: string;
      tier: number;
      points: number;
      board: BoardRow[];
      last: LastWeek | null;
    };

export const leagueState = (player: string, signal?: AbortSignal) => rpc<LeagueState>('wordly_league_state', { p_player: player }, signal);
export const leagueJoin = (player: string, name: string, avatar: string, color: string) =>
  rpc<LeagueState>('wordly_league_join', { p_player: player, p_name: name, p_avatar: avatar, p_color: color });
export const leagueClaim = (player: string, week: string) => rpc<{ ok: boolean }>('wordly_league_claim', { p_player: player, p_week: week });

// ───────── private groups ─────────
export interface GroupSummary {
  code: string;
  name: string;
  members: number;
}

export interface GroupBoard {
  code: string;
  name: string;
  owner: boolean;
  week_start: string;
  week_end: string;
  board: BoardRow[];
}

export const groupsMine = (player: string, signal?: AbortSignal) => rpc<GroupSummary[]>('wordly_groups_mine', { p_player: player }, signal);
export const groupCreate = (player: string, name: string) => rpc<GroupBoard>('wordly_group_create', { p_player: player, p_name: name });
export const groupJoin = (player: string, code: string) => rpc<GroupBoard>('wordly_group_join', { p_player: player, p_code: code });
export const groupLeave = (player: string, code: string) => rpc<{ ok: boolean }>('wordly_group_leave', { p_player: player, p_code: code });
export const groupBoard = (player: string, code: string, signal?: AbortSignal) => rpc<GroupBoard>('wordly_group_board', { p_player: player, p_code: code }, signal);

export function groupLink(code: string): string {
  const origin = typeof location !== 'undefined' ? location.origin : 'https://wordly-ar.vercel.app';
  return `${origin}/?g=${code}`;
}

// ───────── anonymous metrics ─────────
export type MetricEvent =
  | 'app_open'
  | 'game_start'
  | 'game_end'
  | 'share'
  | 'league_join'
  | 'group_create'
  | 'group_join'
  | 'tutorial_done'
  | 'archive_play'
  | 'speed_run'
  | 'pack_play'
  | 'hard_on';

/** Fire-and-forget daily counter. Never throws, never blocks, carries no identity. */
export function track(event: MetricEvent, dim = ''): void {
  if (!URL || !KEY || import.meta.env.MODE === 'test') return;
  // local builds / automated tests must not count as real players
  if (typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  void rpc('wordly_track', { p_event: event, p_dim: dim.toLowerCase().replace(/[^a-z0-9_:-]/g, '').slice(0, 24) }).catch(() => undefined);
}
