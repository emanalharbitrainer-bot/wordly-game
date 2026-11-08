import { describe, expect, it } from 'vitest';
import { evaluateGuess, isWinningResult } from '../../src/core/game/letter-evaluator';
import { getLanguageEngine } from '../../src/core/localization/localization-engine';

const en = getLanguageEngine('en');
const ar = getLanguageEngine('ar');
const C = 'correct', P = 'present', A = 'absent';
const evalEn = (secret: string, guess: string) => evaluateGuess(en.toLetters(secret), en.toLetters(guess));
const evalAr = (secret: string, guess: string) => evaluateGuess(ar.toLetters(secret), ar.toLetters(guess));

describe('evaluateGuess — basics', () => {
  it('marks all correct on an exact match', () => {
    expect(evalEn('crane', 'crane')).toEqual([C, C, C, C, C]);
    expect(isWinningResult(evalEn('crane', 'crane'))).toBe(true);
  });
  it('marks letters in the wrong position as present', () => {
    expect(evalEn('crane', 'nacre')).toEqual([P, P, P, P, C]);
  });
  it('marks letters not in the word as absent', () => {
    expect(evalEn('crane', 'pilot')).toEqual([A, A, A, A, A]);
    expect(isWinningResult(evalEn('crane', 'pilot'))).toBe(false);
  });
  it('rejects mismatched lengths', () => {
    expect(() => evaluateGuess(['a', 'b'], ['a'])).toThrow();
  });
});

describe('evaluateGuess — duplicate letters', () => {
  it('spec example: APPLE vs ALLEY', () => {
    expect(evalEn('apple', 'alley')).toEqual([C, P, A, P, A]);
  });
  it('guess has a letter twice, secret once (wrong positions) → only one present', () => {
    expect(evalEn('crane', 'eerie')).toEqual([A, A, P, A, C]); // the final e is green, other e's grey
  });
  it('guess has a letter twice, secret once, one copy correct → the other copy is absent', () => {
    expect(evalEn('label', 'lolly')).toEqual([C, A, P, A, A]); // secret has two L: one green, one yellow (first unmatched copy)
  });
  it('correct match takes priority over an earlier present copy', () => {
    // secret has one E at the end; the earlier E must NOT steal it
    expect(evalEn('crane', 'gecee'.slice(0, 5))).toEqual([A, A, P, A, C]);
  });
  it('secret has a letter twice, guess once → present, not overcounted', () => {
    expect(evalEn('apple', 'paint')).toEqual([P, P, A, A, A]);
  });
  it('secret twice, guess twice in wrong spots → both present', () => {
    expect(evalEn('apple', 'pupal')).toEqual([P, A, C, P, P]);
  });
  it('secret twice, guess three times → only two counted', () => {
    expect(evalEn('geese', 'eeeee')).toEqual([A, C, C, A, C]);
    expect(evalEn('speed', 'eerie')).toEqual([P, P, A, A, A]);
  });
  it('all-same guess against a word with one copy', () => {
    expect(evalEn('crane', 'aaaaa')).toEqual([A, A, C, A, A]);
  });
  it('never reports more correct+present than the secret contains', () => {
    const secrets = ['apple', 'geese', 'llama', 'sassy', 'mamma', 'crane'];
    const guesses = ['alley', 'eerie', 'lolly', 'sissy', 'amass', 'mamma', 'aaaaa', 'sssss'];
    for (const s of secrets) {
      for (const g of guesses) {
        const res = evalEn(s, g);
        const letters = new Set(g);
        for (const l of letters) {
          const marked = [...g].filter((ch, i) => ch === l && res[i] !== A).length;
          const inSecret = [...s].filter((ch) => ch === l).length;
          expect(marked).toBeLessThanOrEqual(inSecret);
          expect(marked).toBe(Math.min(inSecret, [...g].filter((ch) => ch === l).length));
        }
      }
    }
  });
});

describe('evaluateGuess — Arabic', () => {
  it('evaluates Arabic letters in logical (right-to-left reading) order', () => {
    expect(evalAr('مدرسة', 'مدرسة')).toEqual([C, C, C, C, C]);
    expect(evalAr('سيارة', 'طائرة')).toEqual([A, P, A, C, C]);
  });
  it('handles Arabic duplicate letters (ل in لؤلؤة)', () => {
    // secret: ل ؤ ل ؤ ة, guess: ل ل ل ل ل → positions 0 and 2 correct, others absent
    expect(evaluateGuess(ar.toLetters('لؤلؤة'), ['ل', 'ل', 'ل', 'ل', 'ل'])).toEqual([C, A, C, A, A]);
    // guess with ل in wrong places only
    expect(evaluateGuess(ar.toLetters('لؤلؤة'), ['ب', 'ل', 'ب', 'ل', 'ل'])).toEqual([A, P, A, P, A]);
  });
  it('treats ة and ه as different letters, and ى and ي as different letters', () => {
    expect(evaluateGuess(ar.toLetters('سيارة'), ar.toLetters('سياره'))).toEqual([C, C, C, C, A]);
    expect(evaluateGuess(['م', 'و', 'س', 'ي', 'ى'], ['م', 'و', 'س', 'ى', 'ي'])).toEqual([C, C, C, P, P]);
  });
  it('compares hamza-on-alef forms as the same letter after normalization', () => {
    expect(evaluateGuess(ar.toLetters('أريكة'), ar.toLetters('اريكة'))).toEqual([C, C, C, C, C]);
    expect(evaluateGuess(ar.toLetters('إذاعة'), ar.toLetters('اذاعة'))).toEqual([C, C, C, C, C]);
  });
});
