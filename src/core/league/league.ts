/**
 * Weekly league rules shared by the UI. The SERVER is the only authority for points and ranks
 * (supabase/migrations/20261107_wordly_v3.sql); these mirrors exist for display and tests.
 */
export interface Tier {
  id: number;
  ar: string;
  en: string;
  icon: string;
  color: string;
}

export const TIERS: readonly Tier[] = [
  { id: 1, ar: 'البرونزي', en: 'Bronze', icon: '🥉', color: '#c07a46' },
  { id: 2, ar: 'الفضي', en: 'Silver', icon: '🥈', color: '#8d99a6' },
  { id: 3, ar: 'الذهبي', en: 'Gold', icon: '🥇', color: '#d9a62e' },
  { id: 4, ar: 'الزمردي', en: 'Emerald', icon: '💚', color: '#1f9d6b' },
  { id: 5, ar: 'الماسي', en: 'Diamond', icon: '💎', color: '#4aa3df' },
];

export const tierOf = (id: number): Tier => TIERS[Math.min(TIERS.length, Math.max(1, id)) - 1];

export const PROMOTE_TOP = 3;
export const DEMOTE_BOTTOM = 3;
export const DEMOTE_MIN_SIZE = 8;

/** Mirror of wordly_private.wordly_league_points: win 10..20 by attempts, loss 2, hard × 1.5. */
export function leaguePoints(won: boolean, attempts: number, hard: boolean): number {
  const base = won ? 10 + 2 * (6 - Math.min(Math.max(attempts, 1), 6)) : 2;
  return Math.floor((base * (hard ? 3 : 2)) / 2);
}

export type Zone = 'up' | 'down' | 'safe';

/** Which zone a rank sits in for a cohort of `size` players of tier `tier`. */
export function zoneOf(rank: number, size: number, tier: number, points: number): Zone {
  if (rank <= PROMOTE_TOP && points > 0 && tier < TIERS.length) return 'up';
  if (size >= DEMOTE_MIN_SIZE && rank > size - DEMOTE_BOTTOM && tier > 1) return 'down';
  return 'safe';
}

export interface DayStats {
  total: number;
  lost: number;
  dist: Record<string, number>;
}

/**
 * Share of OTHER players this result beat (ties count half), 0..100. Null when fewer than
 * five players finished — a percentage of two people means nothing.
 */
export function percentile(stats: DayStats, won: boolean, attempts: number): number | null {
  if (stats.total < 5) return null;
  const others = stats.total - 1;
  let better = 0;
  let ties = 0;
  if (won) {
    better = stats.lost;
    for (let k = attempts + 1; k <= 6; k++) better += stats.dist[String(k)] ?? 0;
    ties = Math.max(0, (stats.dist[String(attempts)] ?? 0) - 1);
  } else {
    ties = Math.max(0, stats.lost - 1);
  }
  return Math.round(((better + ties / 2) / others) * 100);
}

/** Milliseconds until a Riyadh date (YYYY-MM-DD) starts. Asia/Riyadh is UTC+3 all year. */
export function msUntilRiyadhDate(date: string, now: number = Date.now()): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.max(0, Date.UTC(y, m - 1, d) - 3 * 3600_000 - now);
}
