import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findNewAchievements } from '../../src/core/achievements/achievement-engine';
import { DIFFICULTY_CONFIG, getRules } from '../../src/core/difficulty/difficulty-config';
import { GameEngine, LocalEvaluator, type Evaluator } from '../../src/core/game/game-engine';
import { complete, createSession, pause, resume, typeLetter } from '../../src/core/game/game-session';
import type { GameSession } from '../../src/core/game/game-state';
import { getHintOptions, revealHint } from '../../src/core/hints/hint-engine';
import { getLanguageEngine } from '../../src/core/localization/localization-engine';
import { computeStats, dailyStreak } from '../../src/core/statistics/statistics-engine';
import { WordDictionary, WordEngine, type DictionaryFile } from '../../src/core/words/word-engine';
import { chooseAnswer, seededRng } from '../../src/core/words/word-selector';
import { createRepositories } from '../../src/services/persistence/repositories';
import { JsonStorage, MemoryStore } from '../../src/services/storage/local-storage';
import type { Difficulty, GameResult, Lang } from '../../src/types';

const files: Record<Lang, DictionaryFile> = {
  en: JSON.parse(readFileSync('public/dictionaries/en.json', 'utf8')),
  ar: JSON.parse(readFileSync('public/dictionaries/ar.json', 'utf8')),
};
const dicts: Record<Lang, WordDictionary> = { en: new WordDictionary(files.en), ar: new WordDictionary(files.ar) };

function setup(lang: Lang, difficulty: Difficulty, secretWord?: string) {
  const dict = dicts[lang];
  const rules = getRules(difficulty, 'classic');
  const secret = secretWord ? dict.findAnswer(secretWord)! : chooseAnswer(dict.answers(rules.wordPool), [], seededRng(7));
  const le = getLanguageEngine(lang);
  const engine = new GameEngine(dict, rules, new LocalEvaluator(le.toLetters(secret.w)));
  const session = createSession({ id: 't', mode: 'classic', difficulty, lang, length: 5, maxAttempts: rules.maxAttempts, secret, now: '2026-11-03T00:00:00Z' });
  return { engine, session, secret, le };
}

async function guess(engine: GameEngine, s: GameSession, word: string) {
  const le = getLanguageEngine(s.lang);
  for (const l of le.toLetters(word)) s = typeLetter(s, l);
  return engine.submit(s);
}

describe('full game flow', () => {
  it('wins on the first attempt', async () => {
    const { engine, session } = setup('en', 'normal', 'globe');
    const out = await guess(engine, session, 'globe');
    expect(out.ok && out.session.status).toBe('WON');
    expect(out.ok && out.session.rows).toHaveLength(1);
  });

  it('wins on the last attempt', async () => {
    let { engine, session } = setup('en', 'easy', 'apple');
    for (const w of ['crane', 'pilot', 'mouse', 'water', 'bread']) {
      const out = await guess(engine, session, w);
      expect(out.ok).toBe(true);
      if (out.ok) session = out.session;
    }
    expect(session.status).toBe('PLAYING');
    const out = await guess(engine, session, 'apple');
    expect(out.ok && out.session.status).toBe('WON');
    expect(out.ok && out.session.rows).toHaveLength(6);
  });

  it('loses after the maximum attempts and then rejects further guesses', async () => {
    let { engine, session } = setup('en', 'normal', 'axiom');
    for (const w of ['crane', 'pilot', 'mouse', 'water', 'bread', 'lunch']) {
      const out = await guess(engine, session, w);
      expect(out.ok).toBe(true);
      if (out.ok) session = out.session;
    }
    expect(session.status).toBe('LOST');
    expect(session.rows).toHaveLength(6);
    const after = await guess(engine, session, 'axiom');
    expect(after.ok).toBe(false);
    expect(!after.ok && after.error.code).toBe('not_playing');
  });

  it('rejects unknown words without consuming an attempt', async () => {
    const { engine, session } = setup('en', 'normal', 'globe');
    const out = await guess(engine, session, 'zzzzz');
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error.code).toBe('not_in_dictionary');
    expect(session.rows).toHaveLength(0);
  });

  it('rejects incomplete rows', async () => {
    const { engine, session } = setup('en', 'normal', 'globe');
    const out = await guess(engine, session, 'glo');
    expect(!out.ok && out.error.code).toBe('too_short');
  });

  it('plays a full Arabic round with normalization of hamza forms', async () => {
    const { engine, session } = setup('ar', 'easy', 'طاىرة'.replace('ى', 'ئ'));
    const out = await guess(engine, session, 'طَائِرَة');
    expect(out.ok && out.session.status).toBe('WON');
  });

  it('HARD rejects a guess that ignores a green letter, without consuming an attempt', async () => {
    let { engine, session } = setup('en', 'hard', 'abyss');
    const first = await guess(engine, session, 'alloy');
    expect(first.ok).toBe(true);
    if (first.ok) session = first.session;
    const bad = await guess(engine, session, 'mound');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error.code).toBe('constraint');
    expect(session.rows).toHaveLength(1);
  });

  it('blocks concurrent submissions (double Enter / slow network)', async () => {
    let release!: () => void;
    const slow: Evaluator = {
      evaluate: () => new Promise((res) => (release = () => res({ results: ['absent', 'absent', 'absent', 'absent', 'absent'] }))),
    };
    const dict = dicts.en;
    const engine = new GameEngine(dict, DIFFICULTY_CONFIG.normal, slow);
    let s = createSession({ id: 'x', mode: 'classic', difficulty: 'normal', lang: 'en', length: 5, maxAttempts: 6 });
    for (const l of 'crane') s = typeLetter(s, l);
    const p1 = engine.submit(s);
    const p2 = await engine.submit(s);
    expect(!p2.ok && p2.error.code).toBe('busy');
    release();
    expect((await p1).ok).toBe(true);
  });

  it('PAUSED games accept no input', () => {
    const { session } = setup('en', 'normal', 'globe');
    const paused = pause(session);
    expect(paused.status).toBe('PAUSED');
    expect(typeLetter(paused, 'a')).toBe(paused);
    expect(resume(paused).status).toBe('PLAYING');
    expect(complete(session)).toBe(session); // cannot complete a running game
  });
});

describe('difficulty pools', () => {
  it('each level draws from different answer words', () => {
    for (const lang of ['en', 'ar'] as const) {
      const sets = (['easy', 'normal', 'hard', 'expert'] as const).map((d) => new Set(dicts[lang].answers(d).map((a) => a.w)));
      for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) for (const w of sets[i]) expect(sets[j].has(w)).toBe(false);
    }
  });
  it('chooseAnswer avoids recently used words', () => {
    const pool = dicts.en.answers('easy');
    const recent = pool.slice(0, pool.length - 1).map((a) => a.w);
    expect(chooseAnswer(pool, recent, seededRng(1)).w).toBe(pool.at(-1)!.w);
  });
});

describe('hints', () => {
  it('EASY allows hints, HARD and EXPERT never do', () => {
    for (const d of ['hard', 'expert'] as const) {
      const { session } = setup('en', d);
      expect(getHintOptions(session, getRules(d, 'classic'), 999).every((o) => !o.available && o.reason === 'not_allowed')).toBe(true);
    }
    const { session } = setup('en', 'easy', 'apple');
    const opts = getHintOptions(session, getRules('easy', 'classic'), 999);
    expect(opts.find((o) => o.type === 'category')?.available).toBe(true);
    expect(opts.find((o) => o.type === 'position')?.reason).toBe('needs_present_letter');
  });
  it('letter hint reveals a correct letter in its real position', () => {
    const { session, le, secret } = setup('ar', 'easy', 'مدرسة');
    const h = revealHint('letter', session, seededRng(3))!;
    expect(le.toLetters(secret.w)[h.position!]).toBe(h.letter);
  });
  it('respects coins and per-level limits', () => {
    const { session } = setup('en', 'normal', 'globe');
    const rules = getRules('normal', 'classic');
    const broke = getHintOptions(session, rules, 0);
    expect(broke.every((o) => !o.available)).toBe(true);
    expect(broke.find((o) => o.type === 'category')?.reason).toBe('not_enough_coins');
    const used = { ...session, hints: [{ type: 'category' as const, text: 'x' }] };
    expect(getHintOptions(used, rules, 999).every((o) => o.reason === 'limit_reached' || o.reason === 'already_used')).toBe(true);
  });
});

describe('statistics & achievements', () => {
  const r = (i: number, won: boolean, extra: Partial<GameResult> = {}): GameResult => ({
    id: String(i),
    mode: 'classic',
    difficulty: 'normal',
    lang: 'en',
    won,
    attempts: won ? 3 : 6,
    maxAttempts: 6,
    hintsUsed: 0,
    finishedAt: `2026-11-0${Math.min(9, i)}T10:00:0${i % 10}Z`,
    ...extra,
  });
  it('computes win rate, streaks and distribution', () => {
    const s = computeStats([r(1, true), r(2, true), r(3, false), r(4, true)]);
    expect(s).toMatchObject({ played: 4, wins: 3, winRate: 75, currentStreak: 1, longestStreak: 2, averageAttempts: 3 });
    expect(s.distribution[3]).toBe(3);
  });
  it('computes daily streaks over consecutive days', () => {
    const days = ['2026-11-01', '2026-11-02', '2026-11-03'].map((d, i) => r(i + 1, true, { mode: 'daily', dailyDate: d }));
    expect(dailyStreak(days, 'en', '2026-11-03')).toEqual({ current: 3, best: 3 });
    expect(dailyStreak(days, 'en', '2026-11-05').current).toBe(0);
  });
  it('unlocks achievements once', () => {
    const ctx = { results: [r(1, true, { attempts: 1, difficulty: 'hard' })] };
    const ids = findNewAchievements(ctx, {});
    expect(ids).toEqual(expect.arrayContaining(['first_win', 'perfect_guess', 'hard_winner']));
    expect(findNewAchievements(ctx, Object.fromEntries(ids.map((i) => [i, 'x'])))).toEqual([]);
  });
});

describe('persistence', () => {
  const repos = () => {
    const store = new MemoryStore();
    return { store, repos: createRepositories(new JsonStorage(store)) };
  };
  it('saves and restores an in-progress session', async () => {
    const { repos: r } = repos();
    const { engine, session } = setup('en', 'normal', 'globe');
    const out = await guess(engine, session, 'crane');
    if (!out.ok) throw new Error('guess failed');
    r.sessions.save('classic', out.session);
    expect(r.sessions.load('classic')).toEqual(out.session);
  });
  it('discards corrupted or tampered data', () => {
    const { store, repos: r } = repos();
    store.setItem('wordly:v1:session:classic', '{"id":1}');
    store.setItem('wordly:v1:prefs', 'not json');
    store.setItem('wordly:v1:coins', '-50');
    expect(r.sessions.load('classic')).toBeNull();
    expect(r.preferences.load().uiLang).toBe('ar');
    expect(r.wallet.load()).toBeGreaterThan(0);
  });
  it('never records the same result twice (daily replay protection)', () => {
    const { repos: r } = repos();
    const res: GameResult = { id: 'daily:en:2026-11-03', mode: 'daily', difficulty: 'normal', lang: 'en', won: true, attempts: 3, maxAttempts: 6, hintsUsed: 0, finishedAt: 'x' };
    r.results.add(res);
    r.results.add({ ...res, won: false });
    expect(r.results.load()).toHaveLength(1);
    expect(r.results.load()[0].won).toBe(true);
  });
  it('word engine loads each language lazily and only once', async () => {
    let calls = 0;
    const we = new WordEngine(async (lang) => {
      calls++;
      return files[lang];
    });
    await Promise.all([we.load('en'), we.load('en')]);
    expect(calls).toBe(1);
    await we.load('ar');
    expect(calls).toBe(2);
  });
});
