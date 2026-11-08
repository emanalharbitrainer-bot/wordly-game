import { useMemo } from 'react';
import { create } from 'zustand';
import { findNewAchievements } from '../core/achievements/achievement-engine';
import { getRules } from '../core/difficulty/difficulty-config';
import { GameEngine, LocalEvaluator } from '../core/game/game-engine';
import { addHint, complete, createSession, deleteLetter, markRecorded, pause, resume, typeLetter } from '../core/game/game-session';
import { isFinished, type GameSession } from '../core/game/game-state';
import type { GuessError } from '../core/game/guess-validator';
import { getHintOptions, revealHint } from '../core/hints/hint-engine';
import { resolveKeyPress } from '../core/keyboard/keyboard-engine';
import { computeKeyStates } from '../core/keyboard/keyboard-state';
import type { KeyId } from '../core/keyboard/keyboard-layouts';
import { getLanguageEngine } from '../core/localization/localization-engine';
import { translate, type StringKey } from '../core/localization/ui-strings';
import { wordEngine, type WordDictionary } from '../core/words/word-engine';
import { chooseAnswer, recentWindow } from '../core/words/word-selector';
import { decodePattern, fetchDailyState, isDailyConfigured, RemoteDailyEvaluator, type DailyAnswer, type DailyState } from '../services/daily/daily-client';
import { createRepositories, type Preferences } from '../services/persistence/repositories';
import { checkCustomChallenge, type CustomChallenge } from '../core/custom/custom-challenge';
import type { AnswerEntry, Difficulty, GameMode, GameResult, HintType, KeyState, Lang } from '../types';
import { useProfile, type RoundGain } from '../features/profile/profile-store';
import { loadPacks, packById, pickPackWord } from '../core/packs/packs';
import { addRun, emptySpeedRecord, isSpeedRecord, remainingMs, SPEED_ATTEMPTS, SPEED_MS, SPEED_NEXT_DELAY_MS, speedXp, type SpeedRecord, type SpeedRun } from '../core/speed/speed';
import { TUTORIAL } from '../core/tutorial/tutorial';
import { JsonStorage } from '../services/storage/local-storage';
import { archiveState, setHard, track, V3Error } from '../services/v3/v3-client';
import type { GameSession as Session } from '../core/game/game-state';

/**
 * Application store: the ONLY place where engines, persistence and UI state meet.
 * Components read state and call actions; they never call engines or storage directly.
 */
export type Screen = 'splash' | 'menu' | 'language' | 'difficulty' | 'game' | 'stats' | 'achievements' | 'settings' | 'daily' | 'howto' | 'profile' | 'words' | 'friends' | 'account' | 'duel' | 'league' | 'archive' | 'packs';
export type PlayIntent = 'classic' | 'infinite' | 'custom';
export type SaveSlot = 'classic' | 'infinite' | 'custom';

/** Flip timing — shared with the Tile component so logic and motion stay in sync. */
export const FLIP_STAGGER_MS = 260;
export const FLIP_DURATION_MS = 520;
export const revealDuration = (len: number) => FLIP_STAGGER_MS * (len - 1) + FLIP_DURATION_MS;

const repos = createRepositories();
const store = new JsonStorage();
const isStringListMap = (v: unknown): v is Record<string, string[]> => typeof v === 'object' && v !== null && Object.values(v).every(Array.isArray);

/** Rules for a session, including the daily hard-mode flag. */
export const rulesOf = (s: Pick<Session, 'difficulty' | 'mode' | 'hard'>) => getRules(s.difficulty, s.mode, s.hard);

export interface Toast {
  id: number;
  text: string;
  tone?: 'error' | 'info' | 'success';
}

export interface RoundSummary {
  won: boolean;
  coins: number;
  newAchievements: string[];
  gain?: RoundGain;
  /** League points the server awarded for today's daily (null = none). */
  leaguePoints?: number | null;
}

interface DailyView {
  lang: Lang;
  status: 'idle' | 'loading' | 'ready' | 'error';
  state?: DailyState;
  error?: string;
}

interface AppState {
  prefs: Preferences;
  screen: Screen;
  history: Screen[];
  direction: 1 | -1;
  intent: PlayIntent;
  coins: number;
  results: GameResult[];
  achievements: Record<string, string>;

  session: GameSession | null;
  dictLoading: boolean;
  dictError: string | null;
  submitting: boolean;
  /** Index of the row currently flipping (keyboard colors wait for it). */
  revealingRow: number | null;
  shakeTick: number;
  /** Increments when the round is won — drives the bounce + confetti sequence. */
  celebrateTick: number;
  summary: RoundSummary | null;
  showResult: boolean;
  toast: Toast | null;
  achievementToast: string | null;
  daily: DailyView;
  /** Current / last speed run. */
  speed: SpeedRun | null;
  speedRecord: SpeedRecord;
  /** Words solved per pack id. */
  packProgress: Record<string, string[]>;

  go(screen: Screen, opts?: { intent?: PlayIntent; replace?: boolean }): void;
  back(): void;
  setPrefs(p: Partial<Preferences>): void;
  t(key: StringKey, vars?: Record<string, string | number>): string;
  startGame(mode: GameMode, opts?: { difficulty?: Difficulty; lang?: Lang }): Promise<void>;
  resumeSaved(slot: SaveSlot): Promise<boolean>;
  /** Starts a game from an AI-generated challenge. Returns false if the challenge is invalid. */
  startCustom(ch: CustomChallenge): Promise<boolean>;
  pressKey(key: KeyId): void;
  submit(): Promise<void>;
  useHint(type: HintType): void;
  pauseGame(): void;
  resumeGame(): void;
  closeResult(): void;
  nextRound(): void;
  quitGame(): void;
  loadDaily(lang?: Lang): Promise<void>;
  startDaily(): Promise<void>;
  resetStats(): void;
  showToast(text: string, tone?: Toast['tone']): void;

  /** Plays a past daily from the archive (server-evaluated). */
  startArchive(lang: Lang, date: string): Promise<void>;
  /** Turns hard mode on/off for today's daily (or an archive day) — only before the first guess. */
  setDailyHard(hard: boolean, date?: string): Promise<boolean>;
  startPack(packId: string): Promise<void>;
  startSpeed(lang?: Lang): Promise<void>;
  /** Ends the speed run (clock ran out or the player stopped). */
  endSpeed(): void;
  startTutorial(lang?: Lang): Promise<void>;
  addCoins(n: number): void;
  finishTutorial(): void;
}

let engine: GameEngine | null = null;
let dict: WordDictionary | null = null;
let dailyEvaluator: RemoteDailyEvaluator | null = null;
let toastSeq = 0;

const slotOf = (s: GameSession) => (s.mode === 'daily' ? `daily:${s.lang}` : s.mode);

function newId(): string {
  return crypto.randomUUID();
}

function persistSession(s: GameSession | null) {
  // daily/archive live on the server; speed/tutorial/pack rounds are short and not resumable
  if (!s || (s.mode !== 'classic' && s.mode !== 'infinite' && s.mode !== 'custom')) return;
  if (s.status === 'COMPLETED') repos.sessions.clear(slotOf(s));
  else repos.sessions.save(slotOf(s), s);
}

function dailyAnswerToEntry(a: DailyAnswer): AnswerEntry {
  return { w: a.word, d: a.display, c: a.category, m: a.meaning, t: a.translation ?? undefined, p: a.pronunciation ?? undefined, e: a.example ?? undefined, r: a.root ?? undefined };
}

function errorText(get: () => AppState, e: GuessError | { code: 'busy' } | { code: 'evaluation_failed'; message: string }, lang: Lang): string {
  const { t } = get();
  const le = getLanguageEngine(lang);
  if (e.code === 'constraint') {
    const v = e.violation;
    const vars: Record<string, string | number> = { letter: le.display(v.letter) };
    if ('position' in v) vars.pos = v.position + 1;
    if ('count' in v) vars.count = v.count;
    return t(`err.${v.code}` as StringKey, vars);
  }
  if (e.code === 'not_playing') return '';
  return t(`err.${e.code}` as StringKey);
}

export const useApp = create<AppState>((set, get) => ({
  prefs: repos.preferences.load(),
  screen: 'splash',
  history: [],
  direction: 1,
  intent: 'classic',
  coins: repos.wallet.load(),
  results: repos.results.load(),
  achievements: repos.achievements.load(),
  session: null,
  dictLoading: false,
  dictError: null,
  submitting: false,
  revealingRow: null,
  shakeTick: 0,
  celebrateTick: 0,
  summary: null,
  showResult: false,
  toast: null,
  achievementToast: null,
  daily: { lang: 'ar', status: 'idle' },
  speed: null,
  speedRecord: store.read('speed', isSpeedRecord, emptySpeedRecord()),
  packProgress: store.read('packs', isStringListMap, {}),

  t: (key, vars) => translate(get().prefs.uiLang, key, vars),

  go: (screen, opts) => {
    const { screen: from, history } = get();
    set({
      screen,
      intent: opts?.intent ?? get().intent,
      history: opts?.replace || from === 'splash' ? history : [...history, from],
      direction: 1,
    });
  },

  back: () => {
    const { history } = get();
    const prev = history.at(-1) ?? 'menu';
    set({ screen: prev, history: history.slice(0, -1), direction: -1 });
  },

  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p };
    repos.preferences.save(prefs);
    set({ prefs });
  },

  showToast: (text, tone = 'info') => {
    const id = ++toastSeq;
    set({ toast: { id, text, tone } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 1900);
  },

  startGame: async (mode, opts = {}) => {
    if (mode === 'daily') return get().startDaily();
    const prefs = get().prefs;
    const lang = opts.lang ?? prefs.puzzleLang;
    const difficulty = opts.difficulty ?? prefs.difficulty;
    const rules = getRules(difficulty, mode);
    set({ dictLoading: true, dictError: null, summary: null, showResult: false, revealingRow: null });
    try {
      dict = await wordEngine.load(lang);
    } catch (e) {
      set({ dictLoading: false, dictError: e instanceof Error ? e.message : String(e) });
      return;
    }
    const recent = repos.recentAnswers.load();
    const key = `${lang}:${rules.wordPool}`;
    const pool = dict.answers(rules.wordPool);
    const secret = chooseAnswer(pool, recent[key] ?? []);
    recent[key] = [...(recent[key] ?? []), secret.w].slice(-recentWindow(pool.length));
    repos.recentAnswers.save(recent);

    const le = getLanguageEngine(lang);
    engine = new GameEngine(dict, rules, new LocalEvaluator(le.toLetters(secret.w)));
    const session = createSession({ id: newId(), mode, difficulty, lang, length: dict.length, maxAttempts: rules.maxAttempts, secret });
    session.reveal = secret;
    persistSession(session);
    set({ session, dictLoading: false, intent: mode === 'infinite' ? 'infinite' : 'classic' });
    track('game_start', mode);
    if (get().screen !== 'game') get().go('game');
  },

  resumeSaved: async (slot) => {
    const saved = repos.sessions.load(slot);
    if (!saved || isFinished(saved) || !saved.secret) return false;
    set({ dictLoading: true, dictError: null, summary: null, showResult: false });
    try {
      dict = await wordEngine.load(saved.lang, saved.length);
    } catch (e) {
      set({ dictLoading: false, dictError: e instanceof Error ? e.message : String(e) });
      return false;
    }
    dict.addGuess(saved.secret.w);
    const le = getLanguageEngine(saved.lang);
    engine = new GameEngine(dict, getRules(saved.difficulty, saved.mode), new LocalEvaluator(le.toLetters(saved.secret.w)));
    const session = saved.status === 'PAUSED' ? resume(saved) : saved;
    set({ session, dictLoading: false, intent: saved.mode === 'custom' ? 'custom' : saved.mode === 'infinite' ? 'infinite' : 'classic' });
    get().go('game');
    return true;
  },

  startCustom: async (ch) => {
    const check = checkCustomChallenge(ch);
    if (!check.ok) {
      get().showToast(get().t('ai.invalidChallenge'), 'error');
      return false;
    }
    const prev = get().session;
    if (prev && prev.status === 'PLAYING') persistSession(pause(prev));
    set({ dictLoading: true, dictError: null, summary: null, showResult: false, revealingRow: null });
    try {
      dict = await wordEngine.load(check.lang, check.length);
    } catch (e) {
      set({ dictLoading: false, dictError: e instanceof Error ? e.message : String(e) });
      return false;
    }
    dict.addGuess(check.entry.w); // the AI word is always a valid guess
    const le = getLanguageEngine(check.lang);
    const rules = getRules(check.difficulty, 'custom');
    engine = new GameEngine(dict, rules, new LocalEvaluator(le.toLetters(check.entry.w)));
    const session = createSession({
      id: newId(),
      mode: 'custom',
      difficulty: check.difficulty,
      lang: check.lang,
      length: check.length,
      maxAttempts: check.attempts,
      secret: check.entry,
    });
    session.reveal = check.entry;
    session.topic = check.topic;
    persistSession(session);
    set({ session, dictLoading: false, intent: 'custom' });
    if (get().screen !== 'game') get().go('game');
    return true;
  },

  pressKey: (key) => {
    const { session, revealingRow } = get();
    if (!session || session.status !== 'PLAYING') return;
    const rules = rulesOf(session);
    // keyboard elimination uses only rows whose reveal has finished
    const rows = revealingRow === null ? session.rows : session.rows.slice(0, revealingRow);
    const states = computeKeyStates(rows, rules.keyboardElimination);
    const action = resolveKeyPress(key, states);
    if (!action) return;
    if (action.type === 'enter') {
      void get().submit();
      return;
    }
    // Typing is never blocked by animations — but the next row starts only after a reveal
    // has been committed, which the session already reflects.
    const next = action.type === 'letter' ? typeLetter(session, action.letter) : deleteLetter(session);
    if (next !== session) set({ session: next });
  },

  submit: async () => {
    const { session, submitting } = get();
    if (!session || !engine || submitting || session.status !== 'PLAYING') return;
    set({ submitting: true });
    const outcome = await engine.submit(session);
    if (!outcome.ok) {
      set({ submitting: false });
      const text = errorText(get, outcome.error, session.lang);
      if (outcome.error.code !== 'busy' && text) {
        set({ shakeTick: get().shakeTick + 1 });
        get().showToast(text, 'error');
      }
      return;
    }
    let next = outcome.session;
    if ((next.mode === 'daily' || next.mode === 'archive') && dailyEvaluator?.lastAnswer) next = { ...next, reveal: dailyAnswerToEntry(dailyEvaluator.lastAnswer) };
    const rowIndex = next.rows.length - 1;
    set({ session: next, submitting: false, revealingRow: rowIndex });
    persistSession(next);

    const done = isFinished(next);
    if (done && next.mode === 'speed') speedWordDone(next);
    else if (done && next.mode !== 'tutorial') recordResult();
    setTimeout(() => {
      if (get().session?.id !== next.id) return;
      set({ revealingRow: null });
      if (done && next.mode === 'speed') {
        // straight into the next word while the clock runs
        setTimeout(() => {
          const run = get().speed;
          if (get().session?.id === next.id && run && !run.over && remainingMs(run) > 0) void nextSpeedWord();
        }, SPEED_NEXT_DELAY_MS);
        return;
      }
      if (done) {
        if (next.status === 'WON') set({ celebrateTick: get().celebrateTick + 1 });
        // let the win bounce play before the result sheet slides in
        setTimeout(() => {
          if (get().session?.id === next.id) set({ showResult: true });
        }, next.status === 'WON' ? 900 : 350);
      }
    }, revealDuration(next.length));
  },

  useHint: (type) => {
    const { session, coins } = get();
    if (!session) return;
    const rules = rulesOf(session);
    const option = getHintOptions(session, rules, coins).find((o) => o.type === type);
    if (!option?.available) return;
    const hint = revealHint(type, session);
    if (!hint) return;
    const next = addHint(session, hint);
    const left = coins - option.cost;
    repos.wallet.save(left);
    persistSession(next);
    set({ session: next, coins: left });
  },

  pauseGame: () => {
    const s = get().session;
    if (!s) return;
    const next = pause(s);
    persistSession(next);
    set({ session: next });
  },

  resumeGame: () => {
    const s = get().session;
    if (!s) return;
    set({ session: resume(s) });
  },

  closeResult: () => set({ showResult: false }),

  nextRound: () => {
    const s = get().session;
    if (!s) return;
    const done = complete(s);
    persistSession(done);
    if (s.mode === 'pack' && s.packId) {
      void get().startPack(s.packId);
      return;
    }
    if (s.mode === 'speed') {
      void get().startSpeed(s.lang);
      return;
    }
    void get().startGame(s.mode === 'infinite' ? 'infinite' : 'classic', { difficulty: s.difficulty, lang: s.lang });
  },

  quitGame: () => {
    if (get().speed && !get().speed!.over) get().endSpeed();
    const s = get().session;
    if (s && isFinished(s)) persistSession(complete(s));
    else if (s?.status === 'PLAYING') persistSession(pause(s));
    set({ session: null, showResult: false, summary: null, revealingRow: null });
    engine = null;
    set({ screen: 'menu', history: [], direction: -1 });
  },

  loadDaily: async (langArg) => {
    const lang = langArg ?? get().prefs.puzzleLang;
    if (!isDailyConfigured()) {
      set({ daily: { lang, status: 'error', error: 'not configured' } });
      return;
    }
    set({ daily: { lang, status: 'loading' } });
    try {
      const state = await fetchDailyState(repos.player.id(), lang);
      set({ daily: { lang, status: 'ready', state } });
      // reconcile: a finished server game is always reflected in local statistics
      if (state.status !== 'PLAYING') {
        const id = `daily:${lang}:${state.date}`;
        if (!get().results.some((r) => r.id === id)) {
          const results = repos.results.add({
            id,
            mode: 'daily',
            difficulty: 'normal',
            lang,
            won: state.status === 'WON',
            attempts: state.guesses.length,
            maxAttempts: state.max_attempts,
            hintsUsed: 0,
            finishedAt: new Date().toISOString(),
            dailyDate: state.date,
          });
          set({ results });
        }
      }
    } catch (e) {
      set({ daily: { lang, status: 'error', error: e instanceof Error ? e.message : String(e) } });
    }
  },

  startDaily: async () => {
    const { daily } = get();
    const lang = daily.lang;
    if (daily.status !== 'ready' || !daily.state) {
      await get().loadDaily(lang);
    }
    const st = get().daily.state;
    if (!st) return;
    set({ dictLoading: true, dictError: null, summary: null, showResult: false, revealingRow: null });
    try {
      dict = await wordEngine.load(lang);
    } catch (e) {
      set({ dictLoading: false, dictError: e instanceof Error ? e.message : String(e) });
      return;
    }
    openServerDay(lang, st, false);
  },

  startArchive: async (lang, date) => {
    set({ dictLoading: true, dictError: null, summary: null, showResult: false, revealingRow: null });
    let st: DailyState;
    try {
      [st, dict] = await Promise.all([archiveState(repos.player.id(), lang, date), wordEngine.load(lang)]);
    } catch (e) {
      set({ dictLoading: false });
      get().showToast(get().t('daily.offline'), 'error');
      return;
    }
    track('archive_play', lang);
    openServerDay(lang, st, true);
  },

  setDailyHard: async (hard, date) => {
    const { daily } = get();
    const st = daily.state;
    const day = date ?? st?.date;
    if (!day) return false;
    try {
      const next = await setHard(repos.player.id(), daily.lang, day, hard);
      if (!date || date === st?.date) set({ daily: { ...get().daily, state: next } });
      if (hard) track('hard_on', daily.lang);
      return true;
    } catch (e) {
      get().showToast(e instanceof V3Error && e.code === 'hard_mode_locked' ? (get().prefs.uiLang === 'ar' ? 'لا يمكن تغيير الوضع بعد أول محاولة' : 'Locked after your first guess') : get().t('daily.offline'), 'error');
      return false;
    }
  },

  startPack: async (packId) => {
    const meta = packById(packId);
    if (!meta) return;
    set({ dictLoading: true, dictError: null, summary: null, showResult: false, revealingRow: null, speed: null });
    let entries;
    try {
      const [file, d] = await Promise.all([loadPacks(meta.lang), wordEngine.load(meta.lang)]);
      dict = d;
      entries = file.packs[packId];
      if (!entries?.length) throw new Error('empty pack');
    } catch (e) {
      set({ dictLoading: false, dictError: e instanceof Error ? e.message : String(e) });
      return;
    }
    const prev = get().session;
    const last = prev?.packId === packId ? (prev.secret?.w ?? null) : null;
    const secret = pickPackWord(entries, get().packProgress[packId] ?? [], last);
    dict.addGuess(secret.w);
    const rules = getRules('normal', 'pack');
    engine = new GameEngine(dict, rules, new LocalEvaluator(getLanguageEngine(meta.lang).toLetters(secret.w)));
    const session = createSession({ id: newId(), mode: 'pack', difficulty: 'normal', lang: meta.lang, length: dict.length, maxAttempts: rules.maxAttempts, secret });
    session.reveal = secret;
    session.packId = packId;
    session.topic = get().prefs.uiLang === 'ar' ? meta.ar : meta.en;
    set({ session, dictLoading: false, intent: 'classic' });
    track('pack_play', packId);
    if (get().screen !== 'game') get().go('game');
  },

  startSpeed: async (langArg) => {
    const lang = langArg ?? get().prefs.puzzleLang;
    const now = Date.now();
    set({ speed: { lang, startedAt: now, endsAt: now + SPEED_MS, words: [], over: false }, summary: null, showResult: false });
    track('speed_run', lang);
    await nextSpeedWord();
  },

  endSpeed: () => {
    const run = get().speed;
    if (!run || run.over) return;
    const s = get().session;
    // the word on the board when time ran out counts as missed
    const words = s && s.mode === 'speed' && s.status === 'PLAYING' && s.secret ? [...run.words, { w: s.secret.w, d: s.secret.d, won: false }] : run.words;
    const done: SpeedRun = { ...run, words, over: true, endsAt: Math.min(run.endsAt, Date.now()) };
    const { record, isBest } = addRun(get().speedRecord, done);
    store.write('speed', record);
    const xp = speedXp(done);
    const entries = speedEntries.filter((e) => words.some((w) => w.w === e.w));
    const gain = useProfile.getState().onBonus(xp, run.lang, entries.map((e) => ({ entry: e, won: words.find((w) => w.w === e.w)?.won ?? false })), 'speed');
    const next = s && s.mode === 'speed' && s.status === 'PLAYING' ? { ...s, status: 'LOST' as const, finishedAt: new Date().toISOString(), reveal: s.secret } : s;
    set({ speed: done, speedRecord: record, session: next, summary: { won: isBest, coins: 0, newAchievements: [], gain }, showResult: true, revealingRow: null });
    track('game_end', `speed:${words.filter((w) => w.won).length}`);
  },

  startTutorial: async (langArg) => {
    const lang = langArg ?? get().prefs.uiLang;
    set({ dictLoading: true, dictError: null, summary: null, showResult: false, revealingRow: null, speed: null });
    try {
      dict = await wordEngine.load(lang);
    } catch (e) {
      set({ dictLoading: false, dictError: e instanceof Error ? e.message : String(e) });
      return;
    }
    const { secret } = TUTORIAL[lang];
    dict.addGuess(secret.w);
    const rules = getRules('easy', 'tutorial');
    engine = new GameEngine(dict, rules, new LocalEvaluator(getLanguageEngine(lang).toLetters(secret.w)));
    const session = createSession({ id: newId(), mode: 'tutorial', difficulty: 'easy', lang, length: dict.length, maxAttempts: rules.maxAttempts, secret });
    session.reveal = secret;
    set({ session, dictLoading: false });
    if (get().screen !== 'game') get().go('game');
  },

  addCoins: (n) => {
    const coins = get().coins + n;
    repos.wallet.save(coins);
    set({ coins });
  },

  finishTutorial: () => {
    get().setPrefs({ seenHowTo: true });
    track('tutorial_done', get().session?.status === 'WON' ? 'won' : 'lost');
    get().quitGame();
  },

  resetStats: () => {
    repos.results.clear();
    repos.achievements.save({});
    set({ results: [], achievements: {} });
  },
}));

/** Opens a server-held day (today's daily or an archive day) as a session. */
function openServerDay(lang: Lang, st: DailyState, archive: boolean) {
  const set = useApp.setState;
  const get = useApp.getState;
  if (!dict) return;
  const le = getLanguageEngine(lang);
  dailyEvaluator = new RemoteDailyEvaluator(repos.player.id(), lang, archive ? st.date : undefined);
  engine = new GameEngine(dict, getRules('normal', archive ? 'archive' : 'daily', st.hard), dailyEvaluator);
  {
    let session = createSession({
      id: `${archive ? 'archive' : 'daily'}:${lang}:${st.date}`,
      mode: archive ? 'archive' : 'daily',
      difficulty: 'normal',
      lang,
      length: st.length,
      maxAttempts: st.max_attempts,
      dailyDate: st.date,
      dailyNumber: st.number,
    });
    session.hard = st.hard ?? false;
    session.rows = st.guesses.map((g, i) => ({ letters: le.toLetters(g), results: decodePattern(st.patterns[i]) }));
    if (st.status !== 'PLAYING') {
      session = { ...session, status: st.status, resultRecorded: true, finishedAt: new Date().toISOString() };
      if (st.answer) session = { ...session, revealedAnswer: st.answer.word, reveal: dailyAnswerToEntry(st.answer) };
    }
    set({ session, dictLoading: false, showResult: st.status !== 'PLAYING' });
    if (get().screen !== 'game') get().go('game');
    if (st.status === 'PLAYING' && st.guesses.length === 0) track('game_start', archive ? 'archive' : 'daily');
  }
}

// ───────── speed mode ─────────
let speedEntries: AnswerEntry[] = [];

async function nextSpeedWord() {
  const { speed: run } = useApp.getState();
  if (!run || run.over) return;
  useApp.setState({ dictLoading: useApp.getState().session?.mode !== 'speed', dictError: null, revealingRow: null });
  try {
    dict = await wordEngine.load(run.lang);
  } catch (e) {
    useApp.setState({ dictLoading: false, dictError: e instanceof Error ? e.message : String(e) });
    return;
  }
  const pool = dict.answers('normal');
  const used = run.words.map((w) => w.w);
  const recent = repos.recentAnswers.load()[`${run.lang}:normal`] ?? [];
  const secret = chooseAnswer(pool, [...used, ...recent.slice(-10)]);
  const rules = getRules('normal', 'speed');
  engine = new GameEngine(dict, rules, new LocalEvaluator(getLanguageEngine(run.lang).toLetters(secret.w)));
  const session = createSession({ id: newId(), mode: 'speed', difficulty: 'normal', lang: run.lang, length: dict.length, maxAttempts: SPEED_ATTEMPTS, secret });
  session.reveal = secret;
  if (!run.words.length) speedEntries = [];
  speedEntries.push(secret);
  useApp.setState({ session, dictLoading: false, intent: 'classic' });
  if (useApp.getState().screen !== 'game') useApp.getState().go('game');
}

/** A speed word finished (won or out of attempts). */
function speedWordDone(s: GameSession) {
  const run = useApp.getState().speed;
  if (!run || run.over || !s.secret) return;
  useApp.setState({ speed: { ...run, words: [...run.words, { w: s.secret.w, d: s.secret.d, won: s.status === 'WON' }] } });
}


/** Sends a finished round to statistics + achievements + wallet exactly once. */
function recordResult() {
  const { session, results, achievements, coins } = useApp.getState();
  if (!session || session.resultRecorded || !isFinished(session)) return;
  const won = session.status === 'WON';
  const rules = rulesOf(session);
  const result: GameResult = {
    id: session.mode === 'daily' || session.mode === 'archive' ? `${session.mode}:${session.lang}:${session.dailyDate}` : session.id,
    mode: session.mode,
    difficulty: session.difficulty,
    lang: session.lang,
    won,
    attempts: session.rows.length,
    maxAttempts: session.maxAttempts,
    hintsUsed: session.hints.length,
    finishedAt: session.finishedAt ?? new Date().toISOString(),
    dailyDate: session.dailyDate,
  };
  const already = results.some((r) => r.id === result.id);
  const nextResults = already ? results : repos.results.add(result);
  const earned = won && !already ? rules.winReward : 0;
  const newIds = findNewAchievements({ results: nextResults }, achievements);
  const now = new Date().toISOString();
  const nextAch = { ...achievements, ...Object.fromEntries(newIds.map((id) => [id, now])) };
  if (newIds.length) repos.achievements.save(nextAch);
  if (earned) repos.wallet.save(coins + earned);
  const gain = already
    ? undefined
    : useProfile.getState().onRound({
        id: result.id, won, mode: session.mode, difficulty: session.difficulty, lang: session.lang, length: session.length,
        attempts: session.rows.length, maxAttempts: session.maxAttempts, hintsUsed: session.hints.length, answer: session.reveal,
      });
  const marked = markRecorded(session);
  persistSession(marked);
  let packProgress = useApp.getState().packProgress;
  if (won && session.mode === 'pack' && session.packId && session.secret) {
    const done = packProgress[session.packId] ?? [];
    if (!done.includes(session.secret.w)) {
      packProgress = { ...packProgress, [session.packId]: [...done, session.secret.w] };
      store.write('packs', packProgress);
    }
  }
  const leaguePoints = session.mode === 'daily' ? (dailyEvaluator?.lastPoints ?? null) : null;
  useApp.setState({
    session: marked,
    results: nextResults,
    achievements: nextAch,
    coins: coins + earned,
    packProgress,
    summary: { won, coins: earned, newAchievements: newIds, gain, leaguePoints },
  });
  if (!already) track('game_end', `${session.mode}:${won ? 'won' : 'lost'}`);
  if (newIds.length) {
    setTimeout(() => useApp.setState({ achievementToast: newIds[0] }), revealDuration(session.length) + 1600);
    setTimeout(() => useApp.setState({ achievementToast: null }), revealDuration(session.length) + 5200);
  }
}

/** Keyboard key states, delayed until the current row finishes flipping. */
export function useKeyStates(): Map<string, KeyState> {
  // `rows` keeps its identity while letters are typed, so the map (and the memoised
  // keyboard) only change when a row is committed or finishes revealing.
  const rows = useApp((s) => s.session?.rows);
  const difficulty = useApp((s) => s.session?.difficulty);
  const mode = useApp((s) => s.session?.mode);
  const revealingRow = useApp((s) => s.revealingRow);
  const hard = useApp((s) => s.session?.hard ?? false);
  return useMemo(() => {
    if (!rows || !difficulty || !mode) return EMPTY_KEYS;
    const rules = getRules(difficulty, mode, hard);
    return computeKeyStates(revealingRow === null ? rows : rows.slice(0, revealingRow), rules.keyboardElimination);
  }, [rows, difficulty, mode, hard, revealingRow]);
}
const EMPTY_KEYS = new Map<string, KeyState>();

/** Anonymous player id (shared by the daily challenge and the AI assistant's usage cap). */
export function getPlayerId(): string {
  return repos.player.id();
}

export function hasSavedSession(slot: SaveSlot): GameSession | null {
  const s = repos.sessions.load(slot);
  return s && !isFinished(s) && s.secret ? s : null;
}
