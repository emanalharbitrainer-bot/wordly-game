import { describe, expect, it } from 'vitest';
import { checkCustomChallenge } from '../../src/core/custom/custom-challenge';

describe('custom challenge validation', () => {
  it('accepts a 6-letter English word and clamps attempts', () => {
    const r = checkCustomChallenge({ lang: 'en', length: 6, attempts: 40, difficulty: 'hard', word: 'Planet', category: 'space', meaning: 'x' } as never);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.length).toBe(6);
      expect(r.attempts).toBe(10);
      expect(r.entry.w).toBe('planet');
    }
  });
  it('rejects a wrong letter count', () => {
    const r = checkCustomChallenge({ lang: 'en', length: 5, attempts: 6, word: 'planet', category: 'c', meaning: 'm' } as never);
    expect(r.ok).toBe(false);
  });
  it('normalizes Arabic hamza forms and counts letters', () => {
    const r = checkCustomChallenge({ lang: 'ar', length: 4, attempts: 5, word: 'أَسَد', category: 'c', meaning: 'm' } as never);
    expect(r.ok).toBe(false); // 3 letters, not 4
    const r2 = checkCustomChallenge({ lang: 'ar', length: 3, attempts: 5, word: 'أَسَد', category: 'c', meaning: 'm' } as never);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.entry.w).toBe('اسد');
  });
  it('rejects letters outside the alphabet', () => {
    expect(checkCustomChallenge({ lang: 'en', length: 5, attempts: 6, word: 'ab1de', category: 'c', meaning: 'm' } as never).ok).toBe(false);
  });
});
