import type { GameResult } from '../../types';
import { computeStats, filterResults } from '../statistics/statistics-engine';

export interface AchievementContext {
  results: readonly GameResult[];
}

export interface AchievementDefinition {
  id: string;
  icon: string;
  /** i18n keys are `ach.<id>.title` and `ach.<id>.desc`. */
  check(ctx: AchievementContext): boolean;
}

const winsIn = (ctx: AchievementContext, f: Parameters<typeof filterResults>[1]) => filterResults(ctx.results, f).filter((r) => r.won).length;

/**
 * Registry of achievements. Adding a new achievement = appending one definition here
 * (plus its two i18n strings). Nothing else needs to change.
 */
export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  { id: 'first_win', icon: '★', check: (c) => c.results.some((r) => r.won) },
  { id: 'perfect_guess', icon: '◎', check: (c) => c.results.some((r) => r.won && r.attempts === 1) },
  { id: 'streak_5', icon: '5', check: (c) => computeStats(c.results).longestStreak >= 5 },
  { id: 'streak_10', icon: '10', check: (c) => computeStats(c.results).longestStreak >= 10 },
  { id: 'daily_champion', icon: '☀', check: (c) => winsIn(c, { mode: 'daily' }) >= 1 },
  { id: 'hard_winner', icon: '▲', check: (c) => c.results.some((r) => r.won && r.difficulty === 'hard' && r.mode !== 'daily') },
  { id: 'expert_player', icon: '◆', check: (c) => c.results.some((r) => r.won && r.difficulty === 'expert' && r.mode !== 'daily') },
  { id: 'arabic_master', icon: 'ض', check: (c) => winsIn(c, { lang: 'ar' }) >= 10 },
  { id: 'english_master', icon: 'E', check: (c) => winsIn(c, { lang: 'en' }) >= 10 },
];

/** Returns ids of achievements that are satisfied now but not yet unlocked. */
export function findNewAchievements(ctx: AchievementContext, unlocked: Readonly<Record<string, string>>): string[] {
  return ACHIEVEMENTS.filter((a) => !unlocked[a.id] && a.check(ctx)).map((a) => a.id);
}
