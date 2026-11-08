import type { Difficulty, Lang } from '../../types';

/**
 * Client for accounts, friends and duels. Every call is a whitelisted security-definer RPC with the
 * publishable key; secrets (passwords, seat tokens) are only ever stored server-side as hashes.
 * Match words are chosen by the `wordly-match` edge function; the answer is only returned once a
 * match is finished.
 */
const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const isSocialConfigured = () => Boolean(URL && KEY);

export class SocialError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function call<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  if (!URL || !KEY) throw new SocialError('offline');
  let res: Response;
  try {
    res = await fetch(`${URL}${path}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new SocialError('network');
  }
  if (!res.ok) throw new SocialError(res.status === 429 ? 'limited' : 'server');
  const data = (await res.json()) as T & { error?: string };
  if (data && typeof data === 'object' && 'error' in data && data.error && !('state' in data)) throw new SocialError(String(data.error));
  return data;
}
const rpc = <T>(fn: string, body: Record<string, unknown>, signal?: AbortSignal) => call<T>(`/rest/v1/rpc/${fn}`, body, signal);

// ───────── accounts ─────────

export interface Account {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  color: string;
}
export interface AuthResult {
  token: string;
  account: Account;
  profile: Record<string, unknown> | null;
}
export interface PlayerCard {
  username: string;
  displayName: string;
  avatar: string;
  color: string;
  xp: number;
  streak: { n: number; d: Difficulty | null; best: number; at: string | null } | null;
  words: number;
}

export const signup = (username: string, password: string, display: string, avatar: string, color: string) =>
  rpc<AuthResult>('wordly_acc_signup', { p_username: username.trim().toLowerCase(), p_password: password, p_display: display, p_avatar: avatar, p_color: color });
export const login = (username: string, password: string) => rpc<AuthResult>('wordly_acc_login', { p_username: username.trim().toLowerCase(), p_password: password });
export const me = (token: string) => rpc<{ account: Account; profile: Record<string, unknown> | null }>('wordly_acc_me', { p_token: token });
export const logout = (token: string) => rpc<{ ok: boolean }>('wordly_acc_logout', { p_token: token });
export const updateAccount = (token: string, display: string, avatar: string, color: string) =>
  rpc<{ account: Account }>('wordly_acc_update', { p_token: token, p_display: display, p_avatar: avatar, p_color: color });
export const changePassword = (token: string, oldPw: string, newPw: string) => rpc<{ ok: boolean }>('wordly_acc_password', { p_token: token, p_old: oldPw, p_new: newPw });
export const saveProfile = (token: string, data: unknown) => rpc<{ ok: boolean }>('wordly_profile_save', { p_token: token, p_data: data });
export const card = (username: string) => rpc<PlayerCard>('wordly_card', { p_username: username.trim().toLowerCase() });

// ───────── friends ─────────

export interface Invite {
  id: string;
  lang: Lang;
  length: number;
  maxAttempts: number | null;
  from: PlayerCard;
  at?: string;
}
export const friends = (token: string) => rpc<{ friends: PlayerCard[]; invites: Invite[] }>('wordly_friends', { p_token: token });
export const addFriend = (token: string, username: string) => rpc<{ ok: boolean; friend: PlayerCard }>('wordly_friend_add', { p_token: token, p_username: username.trim().toLowerCase() });
export const removeFriend = (token: string, username: string) => rpc<{ ok: boolean }>('wordly_friend_remove', { p_token: token, p_username: username });

// ───────── matches ─────────

export interface MatchRow {
  seat: 1 | 2;
  guess: string;
  pattern: string;
  at: string;
}
export interface MatchSeat {
  seat: 1 | 2;
  name: string;
  avatar: string;
  color: string;
  online: boolean;
}
export type RpsChoice = 0 | 1 | 2;
export interface MatchState {
  id: string;
  lang: Lang;
  length: number;
  maxAttempts: number | null;
  difficulty: Difficulty;
  status: 'waiting' | 'playing' | 'finished';
  firstSeat: 1 | 2;
  turn: 1 | 2;
  rows: MatchRow[];
  winner: 1 | 2 | null;
  result: 'win' | 'draw' | 'resign' | null;
  reactions: { seat: 1 | 2; e: string; n: number }[];
  series: { s1: number; s2: number; d: number };
  rematchId: string | null;
  version: number;
  mySeat: 1 | 2 | null;
  seats: MatchSeat[];
  /** Server-decided Rock-Paper-Scissors starter: 0 rock, 1 paper, 2 scissors; [seat1, seat2] per round (ties replay). */
  rps: { rounds: [RpsChoice, RpsChoice][]; winner: 1 | 2 } | null;
  answer: { w: string; d: string; c: string; m: string; t?: string | null; p?: string | null; e?: string | null } | null;
}
export interface MatchConfig {
  lang: Lang;
  length: number;
  maxAttempts: number | null;
  difficulty: Difficulty;
  first: 'host' | 'guest' | 'random';
  name: string;
  avatar: string;
  color: string;
  accountToken?: string | null;
  invite?: string | null;
}

export const createMatch = (cfg: MatchConfig) =>
  call<{ id: string; token: string; state: MatchState }>('/functions/v1/wordly-match', { ...cfg, maxAttempts: cfg.maxAttempts ?? 'inf' });
export const rematch = (id: string, seatToken: string) =>
  call<{ id: string; existing?: boolean; state?: MatchState }>('/functions/v1/wordly-match', { action: 'rematch', id, seatToken });
export const joinMatch = (id: string, name: string, avatar: string, color: string, accountToken: string | null, seatToken: string | null) =>
  rpc<{ seat?: 1 | 2; token?: string; state: MatchState; error?: string }>('wordly_match_join', {
    p_id: id.toUpperCase(), p_name: name, p_avatar: avatar, p_color: color, p_account_token: accountToken, p_seat_token: seatToken,
  });
export const matchState = (id: string, seatToken: string | null, since: number | null, signal?: AbortSignal) =>
  rpc<MatchState | { unchanged: true; version: number }>('wordly_match_state', { p_id: id.toUpperCase(), p_seat_token: seatToken, p_since: since }, signal);
export const matchGuess = (id: string, seatToken: string, guess: string, known: boolean) =>
  rpc<MatchState & { error?: string; state?: MatchState }>('wordly_match_guess', { p_id: id.toUpperCase(), p_seat_token: seatToken, p_guess: guess, p_known: known });
export const matchReact = (id: string, seatToken: string, emoji: string) => rpc<{ ok: boolean }>('wordly_match_react', { p_id: id.toUpperCase(), p_seat_token: seatToken, p_emoji: emoji });
export const matchResign = (id: string, seatToken: string) => rpc<MatchState>('wordly_match_resign', { p_id: id.toUpperCase(), p_seat_token: seatToken });

export const REACTIONS = ['😂', '🔥', '😮', '👏', '😤', '❤️'] as const;

export function matchLink(id: string): string {
  const base = typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : 'https://wordly-ar.vercel.app/';
  return `${base}?m=${id}`;
}
