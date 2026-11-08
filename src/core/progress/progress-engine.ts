import type { Difficulty, GameMode, Lang } from '../../types';

/**
 * Progress engine — pure functions only (XP, levels, streak, flame tiers, learned words, sync merge).
 * Everything is derived from a single serializable `Progress` object so it can be stored locally,
 * synced to an account and merged across devices without conflicts.
 */

export const DIFF_RANK: Record<Difficulty, number> = { easy: 1, normal: 2, hard: 3, expert: 4 };
const RANK_DIFF: Difficulty[] = ['easy', 'easy', 'normal', 'hard', 'expert'];

export interface LearnedWord {
  /** normalized word */
  w: string;
  lang: Lang;
  d: string;
  m: string;
  c?: string;
  t?: string;
  p?: string;
  e?: string;
  /** Arabic root */
  r?: string;
  /** solved at least once */
  won: boolean;
  mode: GameMode | 'duel';
  /** first time seen (ISO) */
  first: string;
  /** last time seen (ISO) */
  last: string;
  count: number;
  fav?: boolean;
}

export interface Progress {
  v: 1;
  xp: number;
  /** Riyadh calendar day (YYYY-MM-DD) → highest difficulty rank won that day (classic 5 letters or daily). */
  days: Record<string, number>;
  /** days covered by a shield (kept in the streak without a win) */
  shielded: string[];
  shields: number;
  /** best streak ever reached */
  best: number;
  /** words seen, keyed `${lang}:${w}` */
  words: Record<string, LearnedWord>;
  /** match ids already rewarded (duels are rewarded once) */
  duels: string[];
  duelStats: { w: number; l: number; d: number };
  /** last level the player has SEEN celebrated */
  seenLevel: number;
  /** last streak milestone celebrated */
  seenMilestone: number;
}

export const emptyProgress = (): Progress => ({
  v: 1, xp: 0, days: {}, shielded: [], shields: 0, best: 0, words: {}, duels: [], duelStats: { w: 0, l: 0, d: 0 }, seenLevel: 1, seenMilestone: 0,
});

// ───────── dates (Asia/Riyadh, UTC+3 with no DST) ─────────

export function dayKey(at: Date | string = new Date()): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}
export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ───────── XP & levels ─────────

const BASE_XP: Record<Difficulty, number> = { easy: 20, normal: 30, hard: 45, expert: 65 };

export interface RoundInput {
  won: boolean;
  difficulty: Difficulty;
  attempts: number;
  maxAttempts: number;
  hintsUsed: number;
  mode: GameMode;
  /** streak length after this round (for the bonus) */
  streak: number;
}

export function roundXp(r: RoundInput): number {
  if (r.mode === 'tutorial' || r.mode === 'speed') return 0; // tutorial earns nothing; speed is paid per word at the end
  if (!r.won) return r.mode === 'archive' ? 2 : 5;
  const left = Math.max(0, r.maxAttempts - r.attempts);
  const bonus = r.mode === 'archive' ? 0 : Math.min(25, r.streak * 2);
  const hintPenalty = Math.min(0.5, r.hintsUsed * 0.15);
  const xp = Math.round((BASE_XP[r.difficulty] + 5 * left) * (1 - hintPenalty)) + bonus;
  // past dailies are worth half: replaying the archive must not out-earn today's challenge
  return r.mode === 'archive' ? Math.round(xp / 2) : xp;
}
export const DUEL_XP = { win: 40, draw: 15, loss: 8 } as const;

/** cumulative XP needed to REACH level n (level 1 = 0) */
export const xpForLevel = (n: number) => (n <= 1 ? 0 : Math.round(100 * Math.pow(n - 1, 1.35)));

export interface LevelInfo {
  level: number;
  /** xp inside the current level */
  into: number;
  /** xp size of the current level */
  span: number;
  /** 0..1 */
  pct: number;
  title: { ar: string; en: string };
  tier: number;
}

const TITLES: { min: number; ar: string; en: string }[] = [
  { min: 1, ar: 'مبتدئ', en: 'Rookie' },
  { min: 5, ar: 'مستكشف', en: 'Explorer' },
  { min: 10, ar: 'صائد الحروف', en: 'Letter Hunter' },
  { min: 20, ar: 'حكيم الكلمات', en: 'Word Sage' },
  { min: 35, ar: 'أسطورة', en: 'Legend' },
  { min: 50, ar: 'سيّد المعجم', en: 'Lexicon Master' },
];

export function levelInfo(xp: number): LevelInfo {
  let level = 1;
  while (xpForLevel(level + 1) <= xp && level < 999) level++;
  const lo = xpForLevel(level);
  const hi = xpForLevel(level + 1);
  let tier = 0;
  TITLES.forEach((t, i) => level >= t.min && (tier = i));
  return { level, into: xp - lo, span: hi - lo, pct: (xp - lo) / (hi - lo), title: TITLES[tier], tier };
}

// ───────── streak ─────────

export interface StreakInfo {
  /** consecutive days (wins or shielded), ending today or yesterday */
  count: number;
  /** today already counted */
  today: boolean;
  /** at risk: alive from yesterday but not yet played today */
  atRisk: boolean;
  /** difficulty of the flame (highest won on the latest won day) */
  difficulty: Difficulty | null;
  lastDay: string | null;
  shields: number;
  best: number;
}

const alive = (p: Progress, k: string) => k in p.days || p.shielded.includes(k);

export function streakInfo(p: Progress, now: Date = new Date()): StreakInfo {
  const today = dayKey(now);
  let end = alive(p, today) ? today : alive(p, addDays(today, -1)) ? addDays(today, -1) : null;
  let count = 0;
  let latestWon: string | null = null;
  if (end) {
    for (let k = end; alive(p, k); k = addDays(k, -1)) {
      count++;
      if (!latestWon && k in p.days) latestWon = k;
    }
  }
  const rank = latestWon ? p.days[latestWon] : 0;
  return {
    count,
    today: end === today,
    atRisk: !!end && end !== today,
    difficulty: rank ? RANK_DIFF[rank] : null,
    lastDay: end,
    shields: p.shields,
    best: Math.max(p.best, count),
  };
}

/**
 * Before recording today's win: if exactly ONE day was missed and a shield is available, the shield
 * is spent to cover it (so the streak survives). Returns the updated progress.
 */
export function applyShield(p: Progress, now: Date = new Date()): Progress {
  const today = dayKey(now);
  const y = addDays(today, -1);
  const yy = addDays(today, -2);
  if (p.shields > 0 && !alive(p, today) && !alive(p, y) && alive(p, yy)) {
    return { ...p, shields: p.shields - 1, shielded: [...p.shielded, y].slice(-60) };
  }
  return p;
}

/** Records a streak-eligible win today; grants a shield every 7 streak days (max 2). */
export function recordStreakWin(p: Progress, difficulty: Difficulty, now: Date = new Date()): { progress: Progress; streak: StreakInfo; extended: boolean; shieldEarned: boolean } {
  const today = dayKey(now);
  let next = applyShield(p, now);
  const extended = !(today in next.days);
  next = { ...next, days: { ...next.days, [today]: Math.max(next.days[today] ?? 0, DIFF_RANK[difficulty]) } };
  // keep the map bounded (~3 years)
  const keys = Object.keys(next.days).sort();
  if (keys.length > 1100) next.days = Object.fromEntries(keys.slice(-1100).map((k) => [k, next.days[k]]));
  const s = streakInfo(next, now);
  let shieldEarned = false;
  if (extended && s.count > 0 && s.count % 7 === 0 && next.shields < 2) {
    next = { ...next, shields: next.shields + 1 };
    shieldEarned = true;
  }
  next.best = Math.max(next.best, s.count);
  return { progress: next, streak: streakInfo(next, now), extended, shieldEarned };
}

export const isStreakRound = (mode: GameMode, length: number) => (mode === 'classic' || mode === 'daily') && length === 5;

// ───────── flame ─────────

export interface FlameTier {
  tier: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** relative scale of the flame */
  scale: number;
  /** ember particle count */
  embers: number;
  /** flicker speed multiplier */
  speed: number;
  name: { ar: string; en: string };
  next: number | null;
}

const FLAMES: { min: number; scale: number; embers: number; speed: number; ar: string; en: string }[] = [
  { min: 0, scale: 0.55, embers: 0, speed: 0.6, ar: 'جمرة خامدة', en: 'Cold ember' },
  { min: 1, scale: 0.7, embers: 2, speed: 0.9, ar: 'شرارة', en: 'Spark' },
  { min: 3, scale: 0.82, embers: 4, speed: 1, ar: 'شعلة', en: 'Flicker' },
  { min: 7, scale: 0.94, embers: 7, speed: 1.1, ar: 'لهب', en: 'Blaze' },
  { min: 14, scale: 1.0, embers: 10, speed: 1.2, ar: 'نار مستعرة', en: 'Inferno' },
  { min: 30, scale: 1.07, embers: 14, speed: 1.3, ar: 'بركان', en: 'Volcano' },
  { min: 100, scale: 1.14, embers: 20, speed: 1.45, ar: 'شمس', en: 'Supernova' },
];

export function flameTier(count: number): FlameTier {
  let i = 0;
  FLAMES.forEach((f, j) => count >= f.min && (i = j));
  const f = FLAMES[i];
  return { tier: i as FlameTier['tier'], scale: f.scale, embers: f.embers, speed: f.speed, name: { ar: f.ar, en: f.en }, next: FLAMES[i + 1]?.min ?? null };
}

export const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365];

/** Flame palette per difficulty: green / dark green / red / blue; null (no streak) = grey ember. */
export function flameColors(d: Difficulty | null): { core: string; mid: string; outer: string; glow: string } {
  switch (d) {
    case 'easy':
      return { core: '#f4ffd9', mid: '#9be15d', outer: '#3fbf4a', glow: 'rgba(110, 220, 90, 0.55)' };
    case 'normal':
      return { core: '#d9ffe6', mid: '#2fa35a', outer: '#0e5f34', glow: 'rgba(20, 130, 70, 0.55)' };
    case 'hard':
      return { core: '#fff1c9', mid: '#ff7a3d', outer: '#d7262e', glow: 'rgba(240, 70, 50, 0.55)' };
    case 'expert':
      return { core: '#e8f7ff', mid: '#4fb6ff', outer: '#2147d9', glow: 'rgba(60, 130, 255, 0.55)' };
    default:
      return { core: '#e6e6e6', mid: '#a3a3a3', outer: '#6b6b6b', glow: 'rgba(140, 140, 140, 0.35)' };
  }
}

// ───────── learned words ─────────

export interface WordInput {
  w: string;
  lang: Lang;
  d: string;
  m: string;
  c?: string;
  t?: string;
  p?: string;
  e?: string;
  r?: string;
  won: boolean;
  mode: GameMode | 'duel';
}

const MAX_WORDS = 1500;

export function recordWord(p: Progress, wi: WordInput, now: Date = new Date()): Progress {
  const key = `${wi.lang}:${wi.w}`;
  const iso = now.toISOString();
  const prev = p.words[key];
  const entry: LearnedWord = prev
    ? { ...prev, ...pickDefined(wi), won: prev.won || wi.won, last: iso, count: prev.count + 1, mode: wi.mode }
    : { ...wi, first: iso, last: iso, count: 1 };
  let words = { ...p.words, [key]: entry };
  const keys = Object.keys(words);
  if (keys.length > MAX_WORDS) {
    const drop = keys.sort((a, b) => (words[a].last < words[b].last ? -1 : 1)).slice(0, keys.length - MAX_WORDS).filter((k) => !words[k].fav);
    words = Object.fromEntries(Object.entries(words).filter(([k]) => !drop.includes(k)));
  }
  return { ...p, words };
}

function pickDefined(wi: WordInput): Partial<WordInput> {
  return Object.fromEntries(Object.entries(wi).filter(([, v]) => v !== undefined && v !== '')) as Partial<WordInput>;
}

export function toggleFav(p: Progress, key: string): Progress {
  const w = p.words[key];
  return w ? { ...p, words: { ...p.words, [key]: { ...w, fav: !w.fav } } } : p;
}

export const wordList = (p: Progress) => Object.entries(p.words).map(([key, w]) => ({ key, ...w })).sort((a, b) => (a.last < b.last ? 1 : -1));

// ───────── duels ─────────

export function recordDuel(p: Progress, matchId: string, outcome: 'win' | 'loss' | 'draw'): { progress: Progress; xp: number } {
  if (p.duels.includes(matchId)) return { progress: p, xp: 0 };
  const xp = DUEL_XP[outcome];
  const ds = { ...p.duelStats };
  if (outcome === 'win') ds.w++;
  else if (outcome === 'loss') ds.l++;
  else ds.d++;
  return { progress: { ...p, xp: p.xp + xp, duels: [...p.duels, matchId].slice(-300), duelStats: ds }, xp };
}

// ───────── sync ─────────

/** Conflict-free merge of two devices' progress (union of words/days, max of counters). */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const days: Record<string, number> = { ...a.days };
  for (const [k, v] of Object.entries(b.days)) days[k] = Math.max(days[k] ?? 0, v);
  const words: Record<string, LearnedWord> = { ...a.words };
  for (const [k, w] of Object.entries(b.words)) {
    const x = words[k];
    words[k] = !x
      ? w
      : { ...(x.last >= w.last ? w : x), ...(x.last >= w.last ? x : w), won: x.won || w.won, count: Math.max(x.count, w.count), first: x.first < w.first ? x.first : w.first, fav: x.fav || w.fav };
  }
  const duels = [...new Set([...a.duels, ...b.duels])].slice(-300);
  return {
    v: 1,
    xp: Math.max(a.xp, b.xp),
    days,
    shielded: [...new Set([...a.shielded, ...b.shielded])].sort().slice(-60),
    shields: Math.max(a.shields, b.shields),
    best: Math.max(a.best, b.best),
    words,
    duels,
    duelStats: {
      w: Math.max(a.duelStats.w, b.duelStats.w),
      l: Math.max(a.duelStats.l, b.duelStats.l),
      d: Math.max(a.duelStats.d, b.duelStats.d),
    },
    seenLevel: Math.max(a.seenLevel, b.seenLevel),
    seenMilestone: Math.max(a.seenMilestone, b.seenMilestone),
  };
}

export function isProgress(v: unknown): v is Progress {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.v === 1 && typeof o.xp === 'number' && typeof o.days === 'object' && typeof o.words === 'object' && Array.isArray(o.duels) && Array.isArray(o.shielded);
}

/** Small public summary stored with the profile for friend cards. */
export function publicCard(p: Progress, now: Date = new Date()) {
  const s = streakInfo(p, now);
  return { xp: p.xp, streakCard: { n: s.count, d: s.difficulty, best: s.best, at: s.lastDay } };
}

/** Last 14 Riyadh days for the strip: rank won (0 none), shielded flag. */
export function recentDays(p: Progress, n = 14, now: Date = new Date()) {
  const today = dayKey(now);
  return Array.from({ length: n }, (_, i) => {
    const k = addDays(today, i - n + 1);
    return { key: k, rank: p.days[k] ?? 0, shielded: p.shielded.includes(k), today: k === today };
  });
}
