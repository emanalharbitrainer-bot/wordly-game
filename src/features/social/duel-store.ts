import { create } from 'zustand';
import { useApp } from '../../app/store';
import { BACKSPACE, ENTER, type KeyId } from '../../core/keyboard/keyboard-layouts';
import { getLanguageEngine } from '../../core/localization/localization-engine';
import { wordEngine, type WordDictionary } from '../../core/words/word-engine';
import * as api from '../../services/social/social-client';
import { JsonStorage } from '../../services/storage/local-storage';
import type { GuessRow, LetterResult } from '../../types';
import { haptic } from '../assistant/assistant-store';
import { useProfile } from '../profile/profile-store';
import { sfx } from '../profile/sfx';
import { sfmt, sx } from './i18n';

/**
 * Turn-based duel on ONE shared board: both players guess the same secret word (picked by the AI on
 * the server), alternating turns. The server validates turns, evaluates guesses and only reveals the
 * answer at the end. The client polls adaptively (fast while waiting for the opponent, paused when
 * the tab is hidden) using a version number so unchanged polls are tiny.
 */
export type DuelPhase = 'setup' | 'creating' | 'loading' | 'preview' | 'lobby' | 'countdown' | 'playing' | 'finished' | 'error';

export interface DuelSetup {
  lang: 'ar' | 'en';
  length: number;
  maxAttempts: number | null;
  difficulty: 'easy' | 'normal' | 'hard' | 'expert';
  first: 'host' | 'guest' | 'random';
}
export interface FeedLine {
  id: number;
  text: string;
  tone: 'hot' | 'good' | 'cold' | 'win' | 'info';
}
export interface FloatReaction {
  id: number;
  e: string;
  seat: 1 | 2;
  x: number;
}

const storage = new JsonStorage();
const isMap = (v: unknown): v is Record<string, string> => typeof v === 'object' && v !== null && !Array.isArray(v);
const seats = () => storage.read('duelSeats', isMap, {});
function saveSeat(id: string, token: string) {
  const m = seats();
  m[id] = token;
  const keys = Object.keys(m);
  storage.write('duelSeats', Object.fromEntries(keys.slice(-40).map((k) => [k, m[k]])));
}
const rpsSeen = () => storage.read('rpsSeen', isMap, {});
function markRpsSeen(id: string) {
  const m = rpsSeen();
  m[id] = '1';
  const keys = Object.keys(m);
  storage.write('rpsSeen', Object.fromEntries(keys.slice(-60).map((k) => [k, m[k]])));
}
export const REVEAL_MS = (len: number) => 260 * (len - 1) + 520;

const decode = (p: string): LetterResult[] => [...p].map((c) => (c === 'C' ? 'correct' : c === 'P' ? 'present' : 'absent'));

interface DuelState {
  phase: DuelPhase;
  setup: DuelSetup;
  invite: { invite: string; inviteName: string } | null;
  id: string | null;
  token: string | null;
  match: api.MatchState | null;
  current: string[];
  revealing: number | null;
  busy: boolean;
  error: string | null;
  feed: FeedLine[];
  floats: FloatReaction[];
  xpGain: number | null;
  shakeTick: number;
  rematching: boolean;

  prepare(p?: { invite?: string; inviteName?: string }): void;
  setSetup(p: Partial<DuelSetup>): void;
  create(): Promise<void>;
  open(id: string): Promise<void>;
  join(): Promise<void>;
  press(key: KeyId): void;
  submit(): Promise<void>;
  react(e: string): void;
  resign(): Promise<void>;
  rematch(): Promise<void>;
  leave(): void;
  /** Called by the Rock-Paper-Scissors showdown when its animation (or skip) ends. */
  finishShowdown(): void;
}

let dict: WordDictionary | null = null;
let pollGen = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let feedSeq = 0;
let lastReaction = 0;
const rewarded = new Set<string>();

const t = () => sx(useApp.getState().prefs.uiLang);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export function rowsOf(m: api.MatchState | null): (GuessRow & { seat: 1 | 2 })[] {
  if (!m) return [];
  const le = getLanguageEngine(m.lang);
  return m.rows.map((r) => ({ letters: le.toLetters(r.guess), results: decode(r.pattern), seat: r.seat }));
}
export const seatOf = (m: api.MatchState | null, seat: 1 | 2 | null) => m?.seats.find((x) => x.seat === seat) ?? null;

export const useDuel = create<DuelState>((set, get) => {
  function stopPolling() {
    pollGen++;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }

  function schedule(ms: number) {
    const gen = ++pollGen;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => void tick(gen), ms);
  }

  function nextDelay(): number {
    const { match } = get();
    if (!match) return 3000;
    if (document.visibilityState === 'hidden') return 6000;
    if (match.status === 'waiting') return 1400;
    if (match.status === 'finished') return match.rematchId ? 0 : 2500;
    return match.turn === match.mySeat ? 2600 : 900;
  }

  async function tick(gen: number) {
    const { id, token, match } = get();
    if (!id || gen !== pollGen) return;
    if (document.visibilityState === 'hidden') return schedule(4000);
    try {
      const r = await api.matchState(id, token, match?.version ?? null);
      if (gen !== pollGen) return;
      if (!('unchanged' in r)) apply(r);
    } catch {
      /* transient — keep polling */
    }
    if (gen !== pollGen) return;
    const m = get().match;
    if (m?.status === 'finished' && m.rematchId && get().phase === 'finished' && !get().rematching) {
      // opponent started a rematch: show the button state, keep a slow poll
      return schedule(4000);
    }
    schedule(nextDelay());
  }

  function push(text: string, tone: FeedLine['tone']) {
    const line = { id: ++feedSeq, text, tone };
    set({ feed: [...get().feed, line].slice(-3) });
    setTimeout(() => set({ feed: get().feed.filter((f) => f.id !== line.id) }), 4200);
  }

  function commentate(m: api.MatchState, idx: number) {
    const row = m.rows[idx];
    const s = t();
    const who = row.seat === m.mySeat ? (useApp.getState().prefs.uiLang === 'ar' ? 'أنت' : 'You') : (seatOf(m, row.seat)?.name ?? '');
    const c = [...row.pattern].filter((x) => x === 'C').length;
    const p = [...row.pattern].filter((x) => x === 'P').length;
    if (c === m.length) return push(sfmt(pick(s.c.win), { name: who }), 'win');
    if (idx === 0) return push(pick(s.c.first), 'info');
    if (c >= m.length - 1 && m.length > 3) return push(sfmt(pick(s.c.hot), { name: who, n: c }), 'hot');
    if (c >= Math.ceil(m.length / 2)) return push(sfmt(s.c.hot[2], { name: who, n: c }), 'hot');
    if (c + p === 0) return push(sfmt(pick(s.c.cold), { name: who }), 'cold');
    return push(sfmt(pick(s.c.good), { name: who }), 'good');
  }

  function apply(m: api.MatchState) {
    const prev = get().match;
    const sameMatch = prev?.id === m.id;
    const prevRows = sameMatch ? prev!.rows.length : m.rows.length;
    set({ match: m });

    // reactions
    for (const r of m.reactions) {
      if (r.n > lastReaction) {
        lastReaction = r.n;
        if (r.seat !== m.mySeat && sameMatch) floatReaction(r.e, r.seat);
      }
    }

    // new rows → flip animation + commentary
    if (m.rows.length > prevRows) {
      const idx = m.rows.length - 1;
      set({ revealing: idx });
      for (let i = 0; i < m.length; i++) setTimeout(() => sfx.flip(i), 260 * i + 260);
      setTimeout(() => {
        if (get().match?.id !== m.id) return;
        set({ revealing: null });
        commentate(m, idx);
        if (m.status === 'playing' && m.turn === m.mySeat && m.rows[idx].seat !== m.mySeat) {
          sfx.turn();
          haptic([10, 50, 10]);
        }
        if (m.status === 'finished') finish(m);
      }, REVEAL_MS(m.length));
    } else if (m.status === 'finished' && get().phase !== 'finished') {
      finish(m);
    }

    // phase transitions
    const phase = get().phase;
    if (m.status === 'waiting') {
      if (m.mySeat) set({ phase: 'lobby' });
      else set({ phase: 'preview' });
    } else if (m.status === 'playing') {
      if (phase === 'lobby' || phase === 'loading' || phase === 'preview' || phase === 'creating' || (phase === 'finished' && !sameMatch)) {
        if (m.rows.length === 0 && m.mySeat && m.rps && !rpsSeen()[m.id]) set({ phase: 'countdown' });
        else set({ phase: 'playing' });
      }
    } else if (m.status === 'finished' && m.rows.length <= prevRows && phase !== 'finished') {
      set({ phase: 'finished' });
    }
  }

  function finish(m: api.MatchState) {
    set({ phase: 'finished' });
    if (!m.mySeat || rewarded.has(m.id)) return;
    rewarded.add(m.id);
    const outcome = m.result === 'draw' ? 'draw' : m.winner === m.mySeat ? 'win' : 'loss';
    const a = m.answer;
    const entry = a ? { w: a.w, d: a.d, c: a.c, m: a.m, t: a.t ?? undefined, p: a.p ?? undefined, e: a.e ?? undefined } : null;
    const xp = useProfile.getState().onDuel(m.id, outcome, m.lang, entry);
    set({ xpGain: xp || null });
    if (outcome === 'win') {
      sfx.win();
      haptic([20, 60, 20, 60, 40]);
    } else if (outcome === 'loss') sfx.lose();
  }

  function floatReaction(e: string, seat: 1 | 2) {
    const f = { id: ++feedSeq, e, seat, x: 10 + Math.random() * 80 };
    set({ floats: [...get().floats, f].slice(-12) });
    setTimeout(() => set({ floats: get().floats.filter((x) => x.id !== f.id) }), 2600);
  }

  async function loadDict(m: api.MatchState) {
    try {
      dict = await wordEngine.load(m.lang, m.length);
    } catch {
      dict = null;
    }
  }

  function enter(id: string, token: string | null, m: api.MatchState) {
    lastReaction = Math.max(0, ...m.reactions.map((r) => r.n));
    set({ id, token, match: null, current: [], revealing: null, xpGain: null, feed: [], floats: [], rematching: false, error: null });
    if (m.status === 'finished') rewarded.add(m.id); // never re-reward when reopening an old match
    void loadDict(m);
    apply(m);
    if (typeof history !== 'undefined') {
      const url = new URL(location.href);
      url.searchParams.set('m', id);
      history.replaceState(null, '', url.toString());
    }
    schedule(nextDelay());
  }

  return {
    phase: 'setup',
    setup: { lang: useApp.getState().prefs.puzzleLang, length: 5, maxAttempts: 8, difficulty: 'normal', first: 'host' },
    invite: null,
    id: null,
    token: null,
    match: null,
    current: [],
    revealing: null,
    busy: false,
    error: null,
    feed: [],
    floats: [],
    xpGain: null,
    shakeTick: 0,
    rematching: false,

    prepare: (p) => {
      stopPolling();
      set({ phase: 'setup', invite: p?.invite ? { invite: p.invite, inviteName: p.inviteName ?? p.invite } : null, id: null, token: null, match: null, error: null, current: [] });
    },
    setSetup: (p) => set({ setup: { ...get().setup, ...p } }),

    create: async () => {
      const { setup, invite } = get();
      const { identity, token } = useProfile.getState();
      set({ phase: 'creating', error: null });
      try {
        const r = await api.createMatch({ ...setup, name: identity.name || (useApp.getState().prefs.uiLang === 'ar' ? 'لاعب ١' : 'Player 1'), avatar: identity.avatar, color: identity.color, accountToken: token, invite: invite?.invite ?? null });
        saveSeat(r.id, r.token);
        enter(r.id, r.token, r.state);
      } catch (e) {
        set({ phase: 'setup', error: e instanceof api.SocialError ? e.code : 'server' });
      }
    },

    open: async (rawId) => {
      const id = rawId.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      stopPolling();
      if (useApp.getState().screen !== 'duel') useApp.getState().go('duel');
      set({ phase: 'loading', id, error: null, match: null });
      const token = seats()[id] ?? null;
      try {
        const r = await api.matchState(id, token, null);
        if ('unchanged' in r) return;
        if ((r as unknown as { error?: string }).error) throw new api.SocialError((r as unknown as { error: string }).error);
        enter(id, r.mySeat ? token : null, r);
      } catch (e) {
        set({ phase: 'error', error: e instanceof api.SocialError ? e.code : 'server' });
      }
    },

    join: async () => {
      const { id } = get();
      if (!id) return;
      const { identity, token: acc } = useProfile.getState();
      set({ busy: true });
      try {
        const r = await api.joinMatch(id, identity.name || (useApp.getState().prefs.uiLang === 'ar' ? 'لاعب ٢' : 'Player 2'), identity.avatar, identity.color, acc, seats()[id] ?? null);
        if (r.error === 'full' || !r.token) {
          useApp.getState().showToast(t().full, 'info');
          enter(id, null, r.state);
        } else {
          saveSeat(id, r.token);
          enter(id, r.token, r.state);
        }
      } catch (e) {
        set({ phase: 'error', error: e instanceof api.SocialError ? e.code : 'server' });
      } finally {
        set({ busy: false });
      }
    },

    press: (key) => {
      const { match, current, busy, revealing, phase } = get();
      if (!match || phase !== 'playing' || match.status !== 'playing' || match.turn !== match.mySeat || busy) return;
      if (key === ENTER) return void get().submit();
      if (key === BACKSPACE) {
        if (current.length) set({ current: current.slice(0, -1) });
        return;
      }
      if (revealing !== null) return;
      if (current.length < match.length) {
        set({ current: [...current, key] });
        sfx.tap();
      }
    },

    submit: async () => {
      const { match, current, token, busy } = get();
      if (!match || !token || busy || match.turn !== match.mySeat) return;
      const s = t();
      if (current.length < match.length) {
        set({ shakeTick: get().shakeTick + 1 });
        useApp.getState().showToast(useApp.getState().t('err.too_short'), 'error');
        return;
      }
      const guess = current.join('');
      const known = dict ? dict.isValidGuess(guess) : true;
      set({ busy: true });
      try {
        const r = await api.matchGuess(match.id, token, guess, known);
        if (r.error === 'turn' || r.error === 'status') {
          if (r.state) apply(r.state);
          useApp.getState().showToast(s.err[r.error], 'error');
        } else {
          set({ current: [] });
          apply(r as api.MatchState);
          schedule(nextDelay());
        }
      } catch (e) {
        set({ shakeTick: get().shakeTick + 1 });
        haptic([20, 30, 20]);
        useApp.getState().showToast(e instanceof api.SocialError && s.err[e.code] ? s.err[e.code] : s.err.server, 'error');
      } finally {
        set({ busy: false });
      }
    },

    react: (e) => {
      const { match, token } = get();
      if (!match || !token) return;
      haptic(6);
      sfx.pop();
      floatReaction(e, match.mySeat ?? 1);
      void api.matchReact(match.id, token, e).catch(() => undefined);
    },

    resign: async () => {
      const { match, token } = get();
      if (!match || !token) return;
      try {
        apply(await api.matchResign(match.id, token));
      } catch {
        /* ignore */
      }
    },

    rematch: async () => {
      const { match, token } = get();
      if (!match || !token) return;
      set({ rematching: true });
      try {
        const target = match.rematchId ?? (await api.rematch(match.id, token)).id;
        saveSeat(target, token);
        const r = await api.matchState(target, token, null);
        if (!('unchanged' in r)) {
          set({ phase: 'loading' });
          enter(target, token, r);
        }
      } catch (e) {
        useApp.getState().showToast(t().err[e instanceof api.SocialError ? e.code : 'server'] ?? t().err.server, 'error');
      } finally {
        set({ rematching: false });
      }
    },

    finishShowdown: () => {
      const m = get().match;
      if (m) markRpsSeen(m.id);
      if (get().phase !== 'countdown') return;
      set({ phase: m?.status === 'finished' ? 'finished' : 'playing' });
      if (m && m.status === 'playing' && m.turn === m.mySeat) {
        sfx.turn();
        haptic([10, 40, 20]);
      }
    },

    leave: () => {
      stopPolling();
      set({ phase: 'setup', id: null, token: null, match: null, current: [], feed: [], floats: [], invite: null });
      if (typeof history !== 'undefined') {
        const url = new URL(location.href);
        if (url.searchParams.has('m')) {
          url.searchParams.delete('m');
          history.replaceState(null, '', url.toString());
        }
      }
    },
  };
});

/** Opens a duel from a shared link (?m=CODE) once the app is ready. */
export function bootDuelLink() {
  try {
    const id = new URL(location.href).searchParams.get('m');
    if (id && /^[A-Za-z0-9]{6}$/.test(id)) void useDuel.getState().open(id);
  } catch {
    /* ignore */
  }
}
