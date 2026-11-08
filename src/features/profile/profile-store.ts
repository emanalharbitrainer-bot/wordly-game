import { create } from 'zustand';
import {
  emptyProgress, flameTier, isProgress, isStreakRound, levelInfo, mergeProgress, publicCard, recordDuel, recordStreakWin, recordWord, roundXp, STREAK_MILESTONES, streakInfo, toggleFav, wordList,
  type Progress, type StreakInfo,
} from '../../core/progress/progress-engine';
import type { AiPlayerContext } from '../../services/ai/ai-client';
import { JsonStorage } from '../../services/storage/local-storage';
import * as api from '../../services/social/social-client';
import type { AnswerEntry, Difficulty, GameMode, Lang } from '../../types';

/**
 * Player progress + optional account. Works fully offline as a guest; signing in only adds cloud
 * save (merged conflict-free across devices) and friends.
 */
export interface Identity {
  name: string;
  avatar: string;
  color: string;
}
export type Celebration =
  | { id: number; kind: 'level'; level: number; title: { ar: string; en: string } }
  | { id: number; kind: 'streak'; n: number; difficulty: Difficulty | null }
  | { id: number; kind: 'shield' };

export interface RoundGain {
  xp: number;
  before: number;
  after: number;
  streak: StreakInfo | null;
  extended: boolean;
  levelUp: number | null;
}

export const AVATARS = ['🦊', '🐼', '🦉', '🐯', '🐙', '🦄', '🐸', '🐧', '🦁', '🐳', '🦋', '🐲', '🌵', '🍉', '🚀', '⭐'];
export const COLORS: Record<string, string> = { green: '#2f9e6e', gold: '#d9a62e', coral: '#e2614b', blue: '#3b82f6', violet: '#8b5cf6', pink: '#ec4899', teal: '#14b8a6', slate: '#64748b' };
export const colorOf = (c: string) => COLORS[c] ?? COLORS.green;

const storage = new JsonStorage();
const isIdentity = (v: unknown): v is Identity => typeof v === 'object' && v !== null && typeof (v as Identity).name === 'string' && typeof (v as Identity).avatar === 'string';
const isAuth = (v: unknown): v is { token: string; account: api.Account } => typeof v === 'object' && v !== null && typeof (v as { token: string }).token === 'string';
const randomOf = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

interface ProfileState {
  progress: Progress;
  identity: Identity;
  token: string | null;
  account: api.Account | null;
  sync: 'idle' | 'syncing' | 'error' | 'ok';
  celebrations: Celebration[];
  lastGain: RoundGain | null;
  sound: boolean;

  onRound(r: { id: string; won: boolean; mode: GameMode; difficulty: Difficulty; lang: Lang; length: number; attempts: number; maxAttempts: number; hintsUsed: number; answer?: AnswerEntry }): RoundGain;
  onDuel(matchId: string, outcome: 'win' | 'loss' | 'draw', lang: Lang, answer?: AnswerEntry | null): number;
  /** Speed run / league reward: adds XP and records the solved words in "my words". */
  onBonus(xp: number, lang: Lang, words: { entry: AnswerEntry; won: boolean }[], mode: GameMode): RoundGain;
  /** League top-3 reward: a streak shield when there is room (max 2), else false. */
  grantShield(): boolean;
  setIdentity(p: Partial<Identity>): void;
  toggleFav(key: string): void;
  popCelebration(): void;
  setSound(on: boolean): void;

  signup(username: string, password: string): Promise<void>;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  changePassword(oldPw: string, newPw: string): Promise<void>;
  pull(): Promise<void>;
  push(): void;
}

let seq = 0;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function persist(p: Progress) {
  storage.write('progress', p);
}

function profilePayload(p: Progress) {
  return { ...p, ...publicCard(p), wordCount: Object.keys(p.words).length };
}

export const useProfile = create<ProfileState>((set, get) => {
  const auth = storage.read('auth', isAuth, null as unknown as { token: string; account: api.Account });
  return {
    progress: storage.read('progress', isProgress, emptyProgress()),
    identity: storage.read('identity', isIdentity, { name: '', avatar: randomOf(AVATARS), color: randomOf(Object.keys(COLORS)) }),
    token: auth?.token ?? null,
    account: auth?.account ?? null,
    sync: 'idle',
    celebrations: [],
    lastGain: null,
    sound: storage.read('sound', (v): v is boolean => typeof v === 'boolean', true),

    onRound: (r) => {
      let p = get().progress;
      const before = p.xp;
      const lvlBefore = levelInfo(before).level;
      let streak: StreakInfo | null = null;
      let extended = false;
      const cel: Celebration[] = [];
      if (r.won && isStreakRound(r.mode, r.length)) {
        const res = recordStreakWin(p, r.difficulty);
        p = res.progress;
        streak = res.streak;
        extended = res.extended;
        if (res.shieldEarned) cel.push({ id: ++seq, kind: 'shield' });
        const ms = STREAK_MILESTONES.filter((m) => m <= res.streak.count && m > p.seenMilestone).at(-1);
        if (extended && ms) {
          cel.push({ id: ++seq, kind: 'streak', n: res.streak.count, difficulty: res.streak.difficulty });
          p = { ...p, seenMilestone: ms };
        }
      }
      const s = streak ?? streakInfo(p);
      const xp = roundXp({ won: r.won, difficulty: r.difficulty, attempts: r.attempts, maxAttempts: r.maxAttempts, hintsUsed: r.hintsUsed, mode: r.mode, streak: s.today ? s.count : 0 });
      p = { ...p, xp: p.xp + xp };
      if (r.answer) p = recordWord(p, { w: r.answer.w, lang: r.lang, d: r.answer.d, m: r.answer.m, c: r.answer.c, t: r.answer.t, p: r.answer.p, e: r.answer.e, r: r.answer.r, won: r.won, mode: r.mode });
      const lvl = levelInfo(p.xp);
      let levelUp: number | null = null;
      if (lvl.level > lvlBefore && lvl.level > p.seenLevel) {
        levelUp = lvl.level;
        cel.unshift({ id: ++seq, kind: 'level', level: lvl.level, title: lvl.title });
        p = { ...p, seenLevel: lvl.level };
      }
      persist(p);
      const gain: RoundGain = { xp, before, after: p.xp, streak, extended, levelUp };
      set({ progress: p, lastGain: gain, celebrations: [...get().celebrations, ...cel] });
      get().push();
      return gain;
    },

    onBonus: (xp, lang, words, mode) => {
      let p = get().progress;
      const before = p.xp;
      const lvlBefore = levelInfo(before).level;
      p = { ...p, xp: p.xp + xp };
      for (const { entry: a, won } of words) p = recordWord(p, { w: a.w, lang, d: a.d, m: a.m, c: a.c, t: a.t, p: a.p, e: a.e, r: a.r, won, mode });
      const lvl = levelInfo(p.xp);
      let levelUp: number | null = null;
      const cel: Celebration[] = [];
      if (lvl.level > lvlBefore && lvl.level > p.seenLevel) {
        levelUp = lvl.level;
        cel.push({ id: ++seq, kind: 'level', level: lvl.level, title: lvl.title });
        p = { ...p, seenLevel: lvl.level };
      }
      persist(p);
      const gain: RoundGain = { xp, before, after: p.xp, streak: null, extended: false, levelUp };
      set({ progress: p, lastGain: gain, celebrations: [...get().celebrations, ...cel] });
      get().push();
      return gain;
    },

    grantShield: () => {
      const p = get().progress;
      if (p.shields >= 2) return false;
      const next = { ...p, shields: p.shields + 1 };
      persist(next);
      set({ progress: next, celebrations: [...get().celebrations, { id: ++seq, kind: 'shield' }] });
      get().push();
      return true;
    },

    onDuel: (matchId, outcome, lang, answer) => {
      let p = get().progress;
      const lvlBefore = levelInfo(p.xp).level;
      const r = recordDuel(p, matchId, outcome);
      if (!r.xp) return 0;
      p = r.progress;
      if (answer) p = recordWord(p, { w: answer.w, lang, d: answer.d, m: answer.m, c: answer.c, t: answer.t ?? undefined, p: answer.p ?? undefined, e: answer.e ?? undefined, won: outcome === 'win', mode: 'duel' });
      const lvl = levelInfo(p.xp);
      const cel: Celebration[] = [];
      if (lvl.level > lvlBefore && lvl.level > p.seenLevel) {
        cel.push({ id: ++seq, kind: 'level', level: lvl.level, title: lvl.title });
        p = { ...p, seenLevel: lvl.level };
      }
      persist(p);
      set({ progress: p, celebrations: [...get().celebrations, ...cel] });
      get().push();
      return r.xp;
    },

    setIdentity: (patch) => {
      const identity = { ...get().identity, ...patch, name: (patch.name ?? get().identity.name).slice(0, 24) };
      storage.write('identity', identity);
      set({ identity });
      const { token } = get();
      if (token) {
        void api.updateAccount(token, identity.name, identity.avatar, identity.color).then((r) => {
          set({ account: r.account });
          storage.write('auth', { token, account: r.account });
        }).catch(() => undefined);
      }
    },

    toggleFav: (key) => {
      const p = toggleFav(get().progress, key);
      persist(p);
      set({ progress: p });
      get().push();
    },

    popCelebration: () => set({ celebrations: get().celebrations.slice(1) }),
    setSound: (on) => {
      storage.write('sound', on);
      set({ sound: on });
    },

    signup: async (username, password) => {
      const { identity } = get();
      const r = await api.signup(username, password, identity.name || username, identity.avatar, identity.color);
      adopt(r);
      await get().pull();
    },
    login: async (username, password) => {
      const r = await api.login(username, password);
      adopt(r);
      await get().pull();
    },
    logout: async () => {
      const { token } = get();
      if (token) await api.logout(token).catch(() => undefined);
      storage.remove('auth');
      set({ token: null, account: null, sync: 'idle' });
    },
    changePassword: async (oldPw, newPw) => {
      const { token } = get();
      if (!token) throw new api.SocialError('session');
      await api.changePassword(token, oldPw, newPw);
    },

    pull: async () => {
      const { token } = get();
      if (!token) return;
      set({ sync: 'syncing' });
      try {
        const r = await api.me(token);
        const remote = r.profile && isProgress(r.profile) ? (r.profile as Progress) : null;
        const merged = remote ? mergeProgress(get().progress, remote) : get().progress;
        persist(merged);
        set({ progress: merged, account: r.account, sync: 'ok', identity: { name: r.account.displayName, avatar: r.account.avatar, color: r.account.color } });
        storage.write('auth', { token, account: r.account });
        storage.write('identity', get().identity);
        await api.saveProfile(token, profilePayload(merged));
      } catch (e) {
        if (e instanceof api.SocialError && e.code === 'session') {
          storage.remove('auth');
          set({ token: null, account: null, sync: 'idle' });
        } else set({ sync: 'error' });
      }
    },

    push: () => {
      if (!get().token) return;
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(() => {
        const { token, progress } = get();
        if (!token) return;
        set({ sync: 'syncing' });
        api.saveProfile(token, profilePayload(progress)).then(() => set({ sync: 'ok' }), () => set({ sync: 'error' }));
      }, 1200);
    },
  };

  function adopt(r: api.AuthResult) {
    storage.write('auth', { token: r.token, account: r.account });
    const identity = { name: r.account.displayName, avatar: r.account.avatar, color: r.account.color };
    storage.write('identity', identity);
    set({ token: r.token, account: r.account, identity });
  }
});

/** Compact profile for the AI companion (level, streak, recent learned words). */
export function aiPlayerContext(lang: Lang): AiPlayerContext {
  const { progress, identity } = useProfile.getState();
  const li = levelInfo(progress.xp);
  const s = streakInfo(progress);
  const colorName: Record<Difficulty, string> = { easy: 'light green', normal: 'dark green', hard: 'red', expert: 'blue' };
  return {
    name: identity.name || undefined,
    level: li.level,
    title: li.title[lang],
    xp: progress.xp,
    streak: s.count,
    streakColor: s.difficulty ? colorName[s.difficulty] : undefined,
    best: s.best,
    duels: progress.duelStats,
    words: wordList(progress).slice(0, 14).map((w) => ({ w: w.w, lang: w.lang, m: w.m, won: w.won })),
  };
}

/** Derived view used by the profile, menu and assistant. */
export function useStreak(): StreakInfo {
  const progress = useProfile((s) => s.progress);
  return streakInfo(progress);
}
export { flameTier, levelInfo };

if (typeof window !== 'undefined') {
  // refresh cloud progress on start (silently) and when coming back to the tab
  setTimeout(() => void useProfile.getState().pull(), 1500);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void useProfile.getState().pull();
  });
}
