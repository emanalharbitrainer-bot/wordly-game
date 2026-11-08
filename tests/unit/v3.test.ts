import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DAILY_HARD_RULES, DAILY_RULES, getRules, TUTORIAL_RULES } from '../../src/core/difficulty/difficulty-config';
import { checkConstraints } from '../../src/core/difficulty/difficulty-engine';
import { evaluateGuess } from '../../src/core/game/letter-evaluator';
import { createSession } from '../../src/core/game/game-session';
import { getHintOptions, revealHint } from '../../src/core/hints/hint-engine';
import { leaguePoints, msUntilRiyadhDate, percentile, tierOf, zoneOf } from '../../src/core/league/league';
import { getLanguageEngine } from '../../src/core/localization/localization-engine';
import { isPackUnlocked, PACKS, PACK_SIZE, pickPackWord, visiblePacks } from '../../src/core/packs/packs';
import { roundXp } from '../../src/core/progress/progress-engine';
import { seasonAt } from '../../src/core/season/season';
import { addRun, emptySpeedRecord, speedXp } from '../../src/core/speed/speed';
import { coachStep, TUTORIAL } from '../../src/core/tutorial/tutorial';
import { seededRng } from '../../src/core/words/word-selector';
import { buildShareText } from '../../src/utils/share';
import type { AnswerEntry } from '../../src/types';

describe('league rules (mirror of the server)', () => {
  it('scores a daily like the SQL function', () => {
    expect([leaguePoints(true, 1, false), leaguePoints(true, 6, false), leaguePoints(false, 6, false), leaguePoints(true, 1, true), leaguePoints(false, 6, true)]).toEqual([20, 10, 2, 30, 3]);
    expect(leaguePoints(true, 2, true)).toBe(27);
  });
  it('places ranks in promotion / relegation zones', () => {
    expect(zoneOf(1, 10, 2, 50)).toBe('up');
    expect(zoneOf(3, 10, 2, 50)).toBe('up');
    expect(zoneOf(1, 10, 2, 0)).toBe('safe'); // no points, no promotion
    expect(zoneOf(1, 10, 5, 99)).toBe('safe'); // top tier
    expect(zoneOf(8, 10, 2, 5)).toBe('down');
    expect(zoneOf(8, 7, 2, 5)).toBe('safe'); // cohort too small to relegate
    expect(zoneOf(10, 10, 1, 0)).toBe('safe'); // bronze never drops
    expect(tierOf(9).id).toBe(5);
  });
  it('computes "better than X%" with ties counted half', () => {
    const stats = { total: 11, lost: 2, dist: { '1': 0, '2': 1, '3': 3, '4': 3, '5': 1, '6': 1 } };
    // won in 3: beat lost(2) + 4s(3) + 5(1) + 6(1) = 7, ties 2 → (7 + 1) / 10
    expect(percentile(stats, true, 3)).toBe(80);
    expect(percentile(stats, false, 6)).toBe(5);
    expect(percentile({ total: 4, lost: 0, dist: {} }, true, 3)).toBeNull();
  });
  it('counts down to a Riyadh midnight', () => {
    const now = Date.UTC(2026, 10, 7, 20, 0); // 23:00 Riyadh on Saturday
    expect(msUntilRiyadhDate('2026-11-08', now)).toBe(3600_000);
  });
});

describe('seasons (Umm al-Qura)', () => {
  const at = (d: string) => new Date(`${d}T09:00:00Z`);
  it('detects Hijri seasons', () => {
    expect(seasonAt(at('2027-02-07'))).toBeNull();
    expect(seasonAt(at('2027-02-08'))).toBe('ramadan');
    expect(seasonAt(at('2027-03-09'))).toBe('eid-fitr');
    expect(seasonAt(at('2027-03-12'))).toBeNull();
    expect(seasonAt(at('2027-05-15'))).toBe('eid-adha');
    expect(seasonAt(at('2027-05-20'))).toBeNull();
  });
  it('detects Gregorian national days', () => {
    expect(seasonAt(at('2027-02-22'))).toBe('founding');
    expect(seasonAt(at('2026-09-23'))).toBe('national');
    expect(seasonAt(at('2026-11-07'))).toBeNull();
  });
});

describe('word packs', () => {
  const files = {
    ar: JSON.parse(readFileSync('public/dictionaries/packs-ar.json', 'utf8')),
    en: JSON.parse(readFileSync('public/dictionaries/packs-en.json', 'utf8')),
  };
  const dicts = {
    ar: new Set<string>(JSON.parse(readFileSync('public/dictionaries/ar.json', 'utf8')).guesses),
    en: new Set<string>(JSON.parse(readFileSync('public/dictionaries/en.json', 'utf8')).guesses),
  };
  it('every pack has 12 typeable 5-letter words', () => {
    for (const p of PACKS) {
      const words: AnswerEntry[] = files[p.lang].packs[p.id];
      expect(words, p.id).toHaveLength(PACK_SIZE);
      for (const w of words) {
        expect(getLanguageEngine(p.lang).toLetters(w.w), `${p.id}/${w.d}`).toHaveLength(5);
        expect(dicts[p.lang].has(w.w), `${p.id}/${w.d} accepted as a guess`).toBe(true);
        expect(w.m && w.e && w.t && w.p, `${p.id}/${w.d} learning card`).toBeTruthy();
        if (p.lang === 'ar') expect(w.r, `${p.id}/${w.d} root`).toBeTruthy();
      }
    }
  });
  it('unlocks by level, seasonal packs only in season', () => {
    const kitchen = PACKS.find((p) => p.id === 'ar-kitchen')!;
    const nature = PACKS.find((p) => p.id === 'ar-nature')!;
    const ramadan = PACKS.find((p) => p.id === 'ar-ramadan')!;
    expect(isPackUnlocked(kitchen, 1, null)).toBe(true);
    expect(isPackUnlocked(nature, 7, null)).toBe(false);
    expect(isPackUnlocked(nature, 8, null)).toBe(true);
    expect(isPackUnlocked(ramadan, 99, null)).toBe(false);
    expect(isPackUnlocked(ramadan, 1, 'eid-fitr')).toBe(true);
    expect(visiblePacks('ar', null).some((p) => p.seasonal)).toBe(false);
    expect(visiblePacks('ar', 'national').map((p) => p.id)).toContain('ar-national');
  });
  it('serves unsolved words first and never repeats the last one', () => {
    const e = (w: string) => ({ w, d: w, c: '', m: '' });
    const pool = ['aaaaa', 'bbbbb', 'ccccc'].map(e);
    const rng = seededRng(3);
    for (let i = 0; i < 20; i++) expect(pickPackWord(pool, ['aaaaa'], 'bbbbb', rng).w).toBe('ccccc');
    for (let i = 0; i < 20; i++) expect(pickPackWord(pool, ['aaaaa', 'bbbbb', 'ccccc'], 'ccccc', rng).w).not.toBe('ccccc');
  });
});

describe('roots and hints', () => {
  const ar = JSON.parse(readFileSync('public/dictionaries/ar.json', 'utf8'));
  it('every Arabic answer has a root and an English translation', () => {
    for (const pool of Object.values(ar.answers) as AnswerEntry[][]) for (const a of pool) expect(a.r && a.t, a.d).toBeTruthy();
  });
  it('offers the root hint only for Arabic words that have one', () => {
    const secret = ar.answers.easy[0] as AnswerEntry;
    const s = createSession({ id: 'x', mode: 'classic', difficulty: 'easy', lang: 'ar', length: 5, maxAttempts: 6, secret });
    const opt = getHintOptions(s, getRules('easy', 'classic'), 100).find((o) => o.type === 'root')!;
    expect(opt.available).toBe(true);
    expect(revealHint('root', s)).toEqual({ type: 'root', text: secret.r });
    const en = createSession({ id: 'y', mode: 'classic', difficulty: 'easy', lang: 'en', length: 5, maxAttempts: 6, secret: { w: 'crane', d: 'crane', c: '', m: '' } });
    expect(getHintOptions(en, getRules('easy', 'classic'), 100).find((o) => o.type === 'root')!.reason).toBe('not_allowed');
  });
});

describe('mode rules and consistency', () => {
  it('daily / archive have no hints; hard daily adds the hard constraints', () => {
    expect(getRules('easy', 'daily')).toBe(DAILY_RULES);
    expect(getRules('easy', 'archive', true)).toBe(DAILY_HARD_RULES);
    expect(DAILY_HARD_RULES.constraints).toBe('hard');
    expect(DAILY_HARD_RULES.maxHints).toBe(0);
    expect(getRules('expert', 'tutorial')).toBe(TUTORIAL_RULES);
    expect(getRules('expert', 'speed').maxHints).toBe(0);
  });
  it('hard rules reject the same guesses the server rejects', () => {
    const rows = [{ letters: [...'cabin'], results: evaluateGuess([...'crane'], [...'cabin']) }];
    expect(checkConstraints('hard', rows, [...'stamp'])?.code).toBe('must_keep_correct');
    expect(checkConstraints('hard', rows, [...'cloud'])?.code).toBe('must_include');
    expect(checkConstraints('hard', rows, [...'canon'])?.code).toBe('must_move_present');
    expect(checkConstraints('hard', rows, [...'crane'])).toBeNull();
  });
  it('archive pays half XP and no streak bonus; tutorial and speed pay nothing per round', () => {
    const base = { won: true, difficulty: 'normal' as const, attempts: 3, maxAttempts: 6, hintsUsed: 0, streak: 5 };
    const daily = roundXp({ ...base, mode: 'daily' });
    const archive = roundXp({ ...base, mode: 'archive' });
    expect(archive).toBeLessThan(daily / 2 + 1);
    expect(roundXp({ ...base, mode: 'tutorial' })).toBe(0);
    expect(roundXp({ ...base, mode: 'speed' })).toBe(0);
  });
});

describe('speed mode', () => {
  it('keeps the best per language', () => {
    const run = { lang: 'ar' as const, startedAt: 0, endsAt: 120_000, over: true, words: [{ w: 'a', d: 'a', won: true }, { w: 'b', d: 'b', won: false }, { w: 'c', d: 'c', won: true }] };
    const first = addRun(emptySpeedRecord(), run);
    expect(first.isBest).toBe(true);
    expect(first.record.best).toEqual({ ar: 2, en: 0 });
    expect(addRun(first.record, run).isBest).toBe(false);
    expect(speedXp(run)).toBe(8);
  });
});

describe('tutorial', () => {
  it('the suggested first guess shows all three colours', () => {
    for (const lang of ['ar', 'en'] as const) {
      const { secret, suggest } = TUTORIAL[lang];
      const le = getLanguageEngine(lang);
      const results = evaluateGuess(le.toLetters(secret.w), le.toLetters(le.normalize(suggest)));
      expect(new Set(results), lang).toEqual(new Set(['correct', 'present', 'absent']));
      const step = coachStep([{ letters: le.toLetters(suggest), results }], 'PLAYING', lang);
      expect(step).toEqual({ kind: 'colors', seen: ['correct', 'present', 'absent'] });
    }
  });
});

describe('share text', () => {
  const s = createSession({ id: 'd', mode: 'daily', difficulty: 'normal', lang: 'en', length: 5, maxAttempts: 6, dailyNumber: 5 });
  s.rows = [{ letters: [...'cabin'], results: ['correct', 'present', 'absent', 'absent', 'present'] }, { letters: [...'crane'], results: ['correct', 'correct', 'correct', 'correct', 'correct'] }];
  s.status = 'WON';
  s.hard = true;
  it('marks hard mode and never includes the word', () => {
    const text = buildShareText(s, false, 'https://wordly-ar.vercel.app/?d=en');
    expect(text).toContain('#5 2/6*');
    expect(text).not.toMatch(/crane|cabin/);
    expect(text).toContain('?d=en');
  });
  it('uses orange / blue squares in color-blind mode', () => {
    expect(buildShareText(s, true)).toContain('🟧🟦⬛⬛🟦');
  });
});
