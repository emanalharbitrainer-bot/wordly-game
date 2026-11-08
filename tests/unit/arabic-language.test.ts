import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ARABIC_RULES, normalizeArabic, ARABIC_ALPHABET } from '../../src/core/localization/arabic/normalize';
import { graphemeLength, splitGraphemes } from '../../src/core/localization/graphemes';
import { createArabicEngine, getLanguageEngine } from '../../src/core/localization/localization-engine';
import type { DictionaryFile } from '../../src/core/words/word-engine';

const ar = getLanguageEngine('ar');

describe('Arabic normalization', () => {
  it('strips tashkeel without changing letter count or order', () => {
    expect(normalizeArabic('مَدْرَسَةٌ')).toBe('مدرسة');
    expect(ar.toLetters('مَدْرَسَةٌ')).toEqual(['م', 'د', 'ر', 'س', 'ة']);
  });
  it('strips shadda and dagger alef', () => {
    expect(normalizeArabic('سُكَّر')).toBe('سكر');
    expect(normalizeArabic('هٰذا')).toBe('هذا');
  });
  it('removes tatweel (kashida)', () => {
    expect(normalizeArabic('ســيـارة')).toBe('سيارة');
  });
  it('unifies أ إ آ ٱ into ا by default', () => {
    expect(normalizeArabic('أإآٱا')).toBe('ااااا');
  });
  it('keeps ة/ه and ى/ي distinct by default', () => {
    expect(normalizeArabic('ة')).not.toBe(normalizeArabic('ه'));
    expect(normalizeArabic('ى')).not.toBe(normalizeArabic('ي'));
  });
  it('keeps ء ؤ ئ distinct', () => {
    expect(new Set(['ء', 'ؤ', 'ئ'].map((c) => normalizeArabic(c))).size).toBe(3);
  });
  it('rules are configurable per dictionary', () => {
    const merged = createArabicEngine({ ...DEFAULT_ARABIC_RULES, unifyTaaMarbuta: true, unifyAlefMaqsura: true });
    expect(merged.normalize('مكتبة')).toBe('مكتبه');
    expect(merged.normalize('مستشفى')).toBe('مستشفي');
    const strict = createArabicEngine({ ...DEFAULT_ARABIC_RULES, unifyAlef: false });
    expect(strict.normalize('أريكة')).toBe('أريكة');
  });
  it('alphabet has 33 unique letters and every letter is already normalized', () => {
    expect(new Set(ARABIC_ALPHABET).size).toBe(33);
    for (const l of ARABIC_ALPHABET) expect(normalizeArabic(l)).toBe(l);
  });
});

describe('Grapheme clusters', () => {
  it('counts user-perceived characters, not UTF-16 units', () => {
    expect('مَدْرَسَة'.length).toBeGreaterThan(5);
    expect(graphemeLength(normalizeArabic('مَدْرَسَة'))).toBe(5);
    expect(splitGraphemes('👍🏽ab')).toHaveLength(3);
  });
  it('compound / similar Arabic words keep exactly five letters', () => {
    for (const w of ['لؤلؤة', 'مؤسسة', 'جائزة', 'طائرة', 'إذاعة', 'أريكة', 'قراءة', 'مروءة', 'صحراء', 'ميناء']) {
      expect(ar.toLetters(w)).toHaveLength(5);
    }
  });
});

describe('Published dictionaries', () => {
  const load = (lang: 'ar' | 'en') => JSON.parse(readFileSync(`public/dictionaries/${lang}.json`, 'utf8')) as DictionaryFile;

  it('every Arabic word is already normalized with the runtime rules and has 5 letters', () => {
    const d = load('ar');
    for (const w of d.guesses) {
      expect(ar.normalize(w)).toBe(w);
      expect(ar.toLetters(w)).toHaveLength(5);
      for (const l of ar.toLetters(w)) expect(ar.alphabet.has(l)).toBe(true);
    }
  });
  it('every English word is lowercase a-z with 5 letters', () => {
    const d = load('en');
    for (const w of d.guesses) expect(w).toMatch(/^[a-z]{5}$/);
  });
  it('answers are valid guesses, unique, and carry hint metadata', () => {
    for (const lang of ['ar', 'en'] as const) {
      const d = load(lang);
      const guesses = new Set(d.guesses);
      const seen = new Set<string>();
      for (const [level, pool] of Object.entries(d.answers)) {
        expect(pool.length, `${lang}/${level}`).toBeGreaterThanOrEqual(20);
        for (const a of pool) {
          expect(guesses.has(a.w)).toBe(true);
          expect(seen.has(a.w)).toBe(false);
          seen.add(a.w);
          expect(a.c.length).toBeGreaterThan(0);
          expect(a.m.length).toBeGreaterThan(0);
        }
      }
    }
  });
  // The seed only exists in the private workspace; public builds carry no daily words at all.
  it.skipIf(!existsSync('supabase/seed_daily_words.sql'))('daily-only words are not shipped in the browser answer pools', () => {
    const seed = readFileSync('supabase/seed_daily_words.sql', 'utf8');
    for (const lang of ['ar', 'en'] as const) {
      const d = load(lang);
      const shipped = new Set(Object.values(d.answers).flat().map((a) => a.w));
      const re = new RegExp(`\\('${lang}', '([^']+)'`, 'g');
      const daily = [...seed.matchAll(re)].map((m) => m[1]);
      expect(daily.length).toBeGreaterThan(40);
      for (const w of daily) expect(shipped.has(w)).toBe(false);
    }
  });
});
