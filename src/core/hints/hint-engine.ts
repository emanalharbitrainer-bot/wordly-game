import type { HintReveal, HintType } from '../../types';
import { HINT_COSTS, type DifficultyRules } from '../difficulty/difficulty-config';
import { deriveKnowledge } from '../difficulty/difficulty-engine';
import type { GameSession } from '../game/game-state';
import { splitGraphemes } from '../localization/graphemes';
import type { Rng } from '../words/word-selector';

export const HINT_TYPES: readonly HintType[] = ['category', 'meaning', 'root', 'position', 'letter'];

export type HintBlock = 'not_allowed' | 'not_playing' | 'limit_reached' | 'already_used' | 'not_enough_coins' | 'nothing_to_reveal' | 'needs_present_letter';

export interface HintOption {
  type: HintType;
  cost: number;
  available: boolean;
  reason?: HintBlock;
}

/** Positions whose letter the player already knows (green in any row, or revealed by a hint). */
function knownPositions(s: GameSession): Set<number> {
  const known = new Set<number>(deriveKnowledge(s.rows).fixed.keys());
  for (const h of s.hints) if (h.position !== undefined) known.add(h.position);
  return known;
}

function letterCandidates(s: GameSession): number[] {
  if (!s.secret) return [];
  const known = knownPositions(s);
  return splitGraphemes(s.secret.w).map((_, i) => i).filter((i) => !known.has(i));
}

function positionCandidates(s: GameSession): number[] {
  if (!s.secret) return [];
  const secret = splitGraphemes(s.secret.w);
  const k = deriveKnowledge(s.rows);
  const known = knownPositions(s);
  const presentLetters = new Set(k.forbidden.keys());
  return secret.map((l, i) => (presentLetters.has(l) && !known.has(i) ? i : -1)).filter((i) => i >= 0);
}

export function getHintOptions(s: GameSession, rules: DifficultyRules, coins: number): HintOption[] {
  return HINT_TYPES.map((type) => {
    const cost = HINT_COSTS[type];
    const block = ((): HintBlock | undefined => {
      if (!rules.allowedHints.includes(type) || rules.maxHints === 0 || !s.secret) return 'not_allowed';
      if (s.status !== 'PLAYING') return 'not_playing';
      if (s.hints.length >= rules.maxHints) return 'limit_reached';
      if (type === 'root' && (s.lang !== 'ar' || !s.secret.r)) return 'not_allowed';
      if ((type === 'category' || type === 'meaning' || type === 'root') && s.hints.some((h) => h.type === type)) return 'already_used';
      if (type === 'letter' && letterCandidates(s).length === 0) return 'nothing_to_reveal';
      if (type === 'position' && positionCandidates(s).length === 0) return 'needs_present_letter';
      if (coins < cost) return 'not_enough_coins';
      return undefined;
    })();
    return { type, cost, available: !block, reason: block };
  });
}

/** Produces the hint content. Callers must check availability first (and charge coins). */
export function revealHint(type: HintType, s: GameSession, rng: Rng = Math.random): HintReveal | null {
  if (!s.secret) return null;
  const secret = splitGraphemes(s.secret.w);
  switch (type) {
    case 'category':
      return { type, text: s.secret.c };
    case 'meaning':
      return { type, text: s.secret.m };
    case 'root':
      if (!s.secret.r) return null;
      return { type, text: s.secret.r === 'معرّب' ? (s.lang === 'ar' ? 'كلمة معرّبة (ليس لها جذر عربي)' : 'borrowed word') : s.secret.r };
    case 'letter':
    case 'position': {
      const pool = type === 'letter' ? letterCandidates(s) : positionCandidates(s);
      if (pool.length === 0) return null;
      const position = pool[Math.floor(rng() * pool.length) % pool.length];
      return { type, letter: secret[position], position };
    }
  }
}
