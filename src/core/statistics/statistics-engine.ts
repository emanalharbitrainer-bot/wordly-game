import type { Difficulty, GameMode, GameResult, Lang } from '../../types';

export interface StatsSummary {
  played: number;
  wins: number;
  winRate: number;
  currentStreak: number;
  longestStreak: number;
  averageAttempts: number;
  /** wins keyed by the attempt number they were won on (1-based). */
  distribution: Record<number, number>;
  dailyCompleted: number;
}

export interface StatsFilter {
  lang?: Lang;
  difficulty?: Difficulty;
  mode?: GameMode;
}

export function filterResults(results: readonly GameResult[], f: StatsFilter = {}): GameResult[] {
  return results.filter(
    (r) => (!f.lang || r.lang === f.lang) && (!f.difficulty || r.difficulty === f.difficulty) && (!f.mode || r.mode === f.mode),
  );
}

/** All statistics are DERIVED from the result history, so they can never drift out of sync. */
export function computeStats(all: readonly GameResult[], filter: StatsFilter = {}): StatsSummary {
  const results = filterResults(all, filter).sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  const wins = results.filter((r) => r.won);
  let streak = 0;
  let longest = 0;
  for (const r of results) {
    streak = r.won ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  const distribution: Record<number, number> = {};
  for (const r of wins) distribution[r.attempts] = (distribution[r.attempts] ?? 0) + 1;
  return {
    played: results.length,
    wins: wins.length,
    winRate: results.length ? Math.round((wins.length / results.length) * 100) : 0,
    currentStreak: streak,
    longestStreak: longest,
    averageAttempts: wins.length ? Math.round((wins.reduce((n, r) => n + r.attempts, 0) / wins.length) * 10) / 10 : 0,
    distribution,
    dailyCompleted: results.filter((r) => r.mode === 'daily').length,
  };
}

function prevDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Consecutive-day streak for the daily challenge (won days only). The streak is still
 * "alive" if the last win was today or yesterday.
 */
export function dailyStreak(all: readonly GameResult[], lang: Lang, today: string): { current: number; best: number } {
  const wonDays = new Set(all.filter((r) => r.mode === 'daily' && r.lang === lang && r.won && r.dailyDate).map((r) => r.dailyDate!));
  const days = [...wonDays].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev && prevDay(d) === prev ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  let current = 0;
  let cursor = wonDays.has(today) ? today : prevDay(today);
  while (wonDays.has(cursor)) {
    current++;
    cursor = prevDay(cursor);
  }
  return { current, best };
}
