import { describe, expect, it } from 'vitest';
import {
  addDays, dayKey, emptyProgress, flameColors, flameTier, isStreakRound, levelInfo, mergeProgress, recentDays, recordDuel, recordStreakWin, recordWord, roundXp, streakInfo, xpForLevel,
} from '../../src/core/progress/progress-engine';

// 12:00 Riyadh = 09:00 UTC
const at = (day: string, h = 9) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00Z`);

describe('dates', () => {
  it('uses Riyadh calendar days', () => {
    expect(dayKey(new Date('2026-11-04T20:59:00Z'))).toBe('2026-11-04');
    expect(dayKey(new Date('2026-11-04T21:00:00Z'))).toBe('2026-11-05');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('xp & levels', () => {
  it('rewards difficulty, remaining attempts and streak, penalises hints', () => {
    const base = { won: true, attempts: 4, maxAttempts: 6, hintsUsed: 0, mode: 'classic' as const, streak: 0 };
    expect(roundXp({ ...base, difficulty: 'easy' })).toBe(30);
    expect(roundXp({ ...base, difficulty: 'expert' })).toBe(75);
    expect(roundXp({ ...base, difficulty: 'normal', streak: 50 })).toBe(40 + 25);
    expect(roundXp({ ...base, difficulty: 'normal', hintsUsed: 2 })).toBe(28);
    expect(roundXp({ ...base, won: false, difficulty: 'hard' })).toBe(5);
  });
  it('levels grow and are monotonic', () => {
    expect(levelInfo(0).level).toBe(1);
    expect(levelInfo(xpForLevel(2)).level).toBe(2);
    expect(levelInfo(xpForLevel(2) - 1).level).toBe(1);
    let prev = 0;
    for (let n = 2; n < 60; n++) {
      expect(xpForLevel(n)).toBeGreaterThan(prev);
      prev = xpForLevel(n);
    }
    const li = levelInfo(xpForLevel(10) + 5);
    expect(li.level).toBe(10);
    expect(li.title.en).toBe('Letter Hunter');
    expect(li.pct).toBeGreaterThan(0);
    expect(li.pct).toBeLessThan(1);
  });
});

describe('streak', () => {
  it('counts consecutive days and stays alive until the end of the next day', () => {
    let p = emptyProgress();
    for (const d of ['2026-11-01', '2026-11-02', '2026-11-03']) p = recordStreakWin(p, 'normal', at(d)).progress;
    expect(streakInfo(p, at('2026-11-03')).count).toBe(3);
    const tomorrow = streakInfo(p, at('2026-11-04'));
    expect(tomorrow.count).toBe(3);
    expect(tomorrow.atRisk).toBe(true);
    expect(tomorrow.today).toBe(false);
    expect(streakInfo(p, at('2026-11-05')).count).toBe(0);
  });
  it('one win per day extends once; flame colour follows the latest day highest difficulty', () => {
    let p = emptyProgress();
    p = recordStreakWin(p, 'expert', at('2026-11-01')).progress;
    const r1 = recordStreakWin(p, 'easy', at('2026-11-02'));
    expect(r1.extended).toBe(true);
    const r2 = recordStreakWin(r1.progress, 'hard', at('2026-11-02', 15));
    expect(r2.extended).toBe(false);
    expect(r2.streak.count).toBe(2);
    expect(r2.streak.difficulty).toBe('hard');
  });
  it('earns a shield every 7 days (max 2) and spends it on a single missed day', () => {
    let p = emptyProgress();
    let earned = 0;
    for (let i = 0; i < 7; i++) {
      const r = recordStreakWin(p, 'normal', at(addDays('2026-10-01', i)));
      p = r.progress;
      if (r.shieldEarned) earned++;
    }
    expect(earned).toBe(1);
    expect(p.shields).toBe(1);
    // miss 2026-10-08, win 2026-10-09
    const r = recordStreakWin(p, 'normal', at('2026-10-09'));
    expect(r.progress.shields).toBe(0);
    expect(r.streak.count).toBe(9);
    expect(r.progress.best).toBe(9);
    // missing two days breaks it
    const broken = recordStreakWin(r.progress, 'normal', at('2026-10-12'));
    expect(broken.streak.count).toBe(1);
    expect(broken.progress.best).toBe(9);
  });
  it('only classic/daily 5-letter rounds count', () => {
    expect(isStreakRound('classic', 5)).toBe(true);
    expect(isStreakRound('daily', 5)).toBe(true);
    expect(isStreakRound('custom', 5)).toBe(false);
    expect(isStreakRound('classic', 6)).toBe(false);
  });
  it('recent days strip', () => {
    const p = recordStreakWin(emptyProgress(), 'hard', at('2026-11-05')).progress;
    const days = recentDays(p, 14, at('2026-11-05'));
    expect(days).toHaveLength(14);
    expect(days[13]).toMatchObject({ key: '2026-11-05', rank: 3, today: true });
  });
});

describe('flame', () => {
  it('has growing tiers', () => {
    expect(flameTier(0).tier).toBe(0);
    expect(flameTier(1).tier).toBe(1);
    expect(flameTier(6).tier).toBe(2);
    expect(flameTier(7).tier).toBe(3);
    expect(flameTier(29).tier).toBe(4);
    expect(flameTier(30).tier).toBe(5);
    expect(flameTier(100).tier).toBe(6);
    expect(flameTier(100).next).toBeNull();
    expect(flameTier(100).scale).toBeGreaterThan(flameTier(1).scale);
  });
  it('colours per difficulty', () => {
    expect(flameColors('easy').outer).not.toBe(flameColors('normal').outer);
    expect(flameColors('hard').outer).toBe('#d7262e');
    expect(flameColors('expert').outer).toBe('#2147d9');
  });
});

describe('words & duels & merge', () => {
  it('records and merges words', () => {
    let p = recordWord(emptyProgress(), { w: 'قافلة', lang: 'ar', d: 'قافلة', m: 'مسافرون', won: false, mode: 'classic' }, at('2026-11-01'));
    p = recordWord(p, { w: 'قافلة', lang: 'ar', d: 'قافلة', m: 'مسافرون', won: true, mode: 'duel' }, at('2026-11-02'));
    const w = p.words['ar:قافلة'];
    expect(w.count).toBe(2);
    expect(w.won).toBe(true);
    expect(w.first.startsWith('2026-11-01')).toBe(true);
    const other = recordWord(emptyProgress(), { w: 'crane', lang: 'en', d: 'crane', m: 'bird', won: true, mode: 'classic' }, at('2026-11-03'));
    const m = mergeProgress(p, { ...other, xp: 500, days: { '2026-11-03': 4 } });
    expect(Object.keys(m.words).sort()).toEqual(['ar:قافلة', 'en:crane']);
    expect(m.xp).toBe(500);
    expect(m.days['2026-11-03']).toBe(4);
  });
  it('rewards each duel once', () => {
    const a = recordDuel(emptyProgress(), 'ABC123', 'win');
    expect(a.xp).toBe(40);
    const b = recordDuel(a.progress, 'ABC123', 'win');
    expect(b.xp).toBe(0);
    expect(b.progress.duelStats.w).toBe(1);
  });
});
