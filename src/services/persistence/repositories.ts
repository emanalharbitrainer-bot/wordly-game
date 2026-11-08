import { STARTING_COINS } from '../../core/difficulty/difficulty-config';
import type { GameSession } from '../../core/game/game-state';
import type { Difficulty, GameResult, Lang } from '../../types';
import { JsonStorage, type Validator } from '../storage/local-storage';

/**
 * Unified data-access layer. UI components never touch storage directly — they go
 * through the app store, which uses these repositories.
 */
export interface Preferences {
  uiLang: Lang;
  puzzleLang: Lang;
  difficulty: Difficulty;
  theme: 'system' | 'light' | 'dark';
  reducedMotion: 'system' | 'on' | 'off';
  physicalKeyboard: boolean;
  highContrast: boolean;
  seenHowTo: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  uiLang: 'ar',
  puzzleLang: 'ar',
  difficulty: 'normal',
  theme: 'system',
  reducedMotion: 'system',
  physicalKeyboard: false,
  highContrast: false,
  seenHowTo: false,
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isLang = (v: unknown): v is Lang => v === 'ar' || v === 'en';
const isDifficulty = (v: unknown): v is Difficulty => v === 'easy' || v === 'normal' || v === 'hard' || v === 'expert';
const MODES = new Set(['classic', 'daily', 'infinite', 'custom']);
const STATUSES = new Set(['IDLE', 'PLAYING', 'WON', 'LOST', 'PAUSED', 'COMPLETED']);
const RESULTS = new Set(['correct', 'present', 'absent']);

export const isPreferences: Validator<Preferences> = (v): v is Preferences =>
  isObj(v) &&
  isLang(v.uiLang) &&
  isLang(v.puzzleLang) &&
  isDifficulty(v.difficulty) &&
  ['system', 'light', 'dark'].includes(v.theme as string) &&
  ['system', 'on', 'off'].includes(v.reducedMotion as string) &&
  typeof v.physicalKeyboard === 'boolean' &&
  typeof v.highContrast === 'boolean' &&
  typeof v.seenHowTo === 'boolean';

export const isSession: Validator<GameSession> = (v): v is GameSession => {
  if (!isObj(v)) return false;
  const { rows, current, length, maxAttempts } = v as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    MODES.has(v.mode as string) &&
    isDifficulty(v.difficulty) &&
    isLang(v.lang) &&
    typeof length === 'number' &&
    typeof maxAttempts === 'number' &&
    STATUSES.has(v.status as string) &&
    Array.isArray(current) &&
    current.length <= length &&
    Array.isArray(rows) &&
    rows.length <= maxAttempts &&
    rows.every(
      (r) =>
        isObj(r) &&
        Array.isArray(r.letters) &&
        Array.isArray(r.results) &&
        r.letters.length === length &&
        r.results.length === length &&
        r.results.every((x: unknown) => RESULTS.has(x as string)),
    ) &&
    Array.isArray(v.hints) &&
    typeof v.resultRecorded === 'boolean'
  );
};

export const isResult = (v: unknown): v is GameResult =>
  isObj(v) &&
  typeof v.id === 'string' &&
  MODES.has(v.mode as string) &&
  isDifficulty(v.difficulty) &&
  isLang(v.lang) &&
  typeof v.won === 'boolean' &&
  typeof v.attempts === 'number' &&
  typeof v.finishedAt === 'string';

const isResultList: Validator<GameResult[]> = (v): v is GameResult[] => Array.isArray(v) && v.every(isResult);
const isStringMap: Validator<Record<string, string>> = (v): v is Record<string, string> =>
  isObj(v) && Object.values(v).every((x) => typeof x === 'string');
const isStringListMap: Validator<Record<string, string[]>> = (v): v is Record<string, string[]> =>
  isObj(v) && Object.values(v).every((x) => Array.isArray(x) && x.every((s) => typeof s === 'string'));
const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

const MAX_RESULTS = 5000;

export function createRepositories(storage = new JsonStorage()) {
  return {
    preferences: {
      load: () => ({ ...DEFAULT_PREFERENCES, ...storage.read('prefs', isPreferences, DEFAULT_PREFERENCES) }),
      save: (p: Preferences) => storage.write('prefs', p),
    },
    /** Active local sessions, one slot per mode so a daily game never overwrites a classic one. */
    sessions: {
      load: (slot: string) => storage.read<GameSession | null>(`session:${slot}`, (v): v is GameSession | null => v === null || isSession(v), null),
      save: (slot: string, s: GameSession) => storage.write(`session:${slot}`, s),
      clear: (slot: string) => storage.remove(`session:${slot}`),
    },
    results: {
      load: () => storage.read('results', isResultList, []),
      /** Appends a result; ignores duplicates by id (safe against double recording). */
      add: (r: GameResult) => {
        const all = storage.read('results', isResultList, []);
        if (all.some((x) => x.id === r.id)) return all;
        const next = [...all, r].slice(-MAX_RESULTS);
        storage.write('results', next);
        return next;
      },
      clear: () => storage.remove('results'),
    },
    achievements: {
      load: () => storage.read('achievements', isStringMap, {}),
      save: (a: Record<string, string>) => storage.write('achievements', a),
    },
    wallet: {
      load: () => storage.read('coins', isNonNegInt, STARTING_COINS),
      save: (n: number) => storage.write('coins', Math.max(0, Math.floor(n))),
    },
    recentAnswers: {
      load: () => storage.read('recent', isStringListMap, {}),
      save: (r: Record<string, string[]>) => storage.write('recent', r),
    },
    player: {
      /** Anonymous, random player id used only for the daily challenge. */
      id: (): string => {
        const existing = storage.read('playerId', isUuid, '');
        if (existing) return existing;
        const id = crypto.randomUUID();
        storage.write('playerId', id);
        return id;
      },
    },
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
