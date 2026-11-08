import type { Difficulty, GameMode, HintType } from '../../types';

/**
 * Central difficulty configuration. Game logic reads ONLY from here, so a level can be
 * tuned (attempts, hints, constraints…) without touching any engine code.
 */
export type ConstraintLevel = 'none' | 'hard' | 'expert';

export interface DifficultyRules {
  id: Difficulty;
  maxAttempts: number;
  /** Which curated answer pool secret words are drawn from. */
  wordPool: Difficulty;
  /** EASY: letters proven absent are removed from the keyboard. */
  keyboardElimination: boolean;
  /** Maximum hints per round (0 = hints disabled). */
  maxHints: number;
  allowedHints: readonly HintType[];
  /**
   * hard   → greens must stay in place, yellows must be reused in a different position.
   * expert → hard + letters proven absent (or over their known count) may not be reused.
   */
  constraints: ConstraintLevel;
  showBeginnerHelp: boolean;
  /** Coins earned for a win. */
  winReward: number;
}

export const DIFFICULTY_CONFIG: Readonly<Record<Difficulty, DifficultyRules>> = Object.freeze({
  easy: {
    id: 'easy',
    maxAttempts: 6,
    wordPool: 'easy',
    keyboardElimination: true,
    maxHints: 3,
    allowedHints: ['category', 'meaning', 'root', 'letter', 'position'],
    constraints: 'none',
    showBeginnerHelp: true,
    winReward: 10,
  },
  normal: {
    id: 'normal',
    maxAttempts: 6,
    wordPool: 'normal',
    keyboardElimination: false,
    maxHints: 1,
    allowedHints: ['category', 'meaning', 'root', 'letter', 'position'],
    constraints: 'none',
    showBeginnerHelp: false,
    winReward: 15,
  },
  hard: {
    id: 'hard',
    maxAttempts: 5,
    wordPool: 'hard',
    keyboardElimination: false,
    maxHints: 0,
    allowedHints: [],
    constraints: 'hard',
    showBeginnerHelp: false,
    winReward: 25,
  },
  expert: {
    id: 'expert',
    maxAttempts: 4,
    wordPool: 'expert',
    keyboardElimination: false,
    maxHints: 0,
    allowedHints: [],
    constraints: 'expert',
    showBeginnerHelp: false,
    winReward: 40,
  },
});

/** Hint prices in coins. */
export const HINT_COSTS: Readonly<Record<HintType, number>> = Object.freeze({
  category: 5,
  meaning: 10,
  root: 10,
  position: 15,
  letter: 20,
});

export const STARTING_COINS = 60;

export const DAILY_RULES: Readonly<DifficultyRules> = Object.freeze({
  ...DIFFICULTY_CONFIG.normal,
  // The daily secret lives only on the server, so hints that need the answer are disabled.
  maxHints: 0,
  allowedHints: [],
  winReward: 20,
});

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard', 'expert'];

/** Daily played in hard mode: same server-held secret, plus the "hard" constraints (checked on both sides). */
export const DAILY_HARD_RULES: Readonly<DifficultyRules> = Object.freeze({ ...DAILY_RULES, constraints: 'hard' as const });

/** Guided first round: easy keyboard help, no hints, nothing recorded. */
export const TUTORIAL_RULES: Readonly<DifficultyRules> = Object.freeze({ ...DIFFICULTY_CONFIG.easy, maxHints: 0, allowedHints: [], winReward: 0 });

/** Speed mode: normal words, no hints (the clock is the challenge). */
export const SPEED_RULES: Readonly<DifficultyRules> = Object.freeze({ ...DIFFICULTY_CONFIG.normal, maxHints: 0, allowedHints: [], winReward: 0 });

export function getRules(difficulty: Difficulty, mode: GameMode, hard = false): DifficultyRules {
  if (mode === 'daily' || mode === 'archive') return hard ? DAILY_HARD_RULES : DAILY_RULES;
  if (mode === 'tutorial') return TUTORIAL_RULES;
  if (mode === 'speed') return SPEED_RULES;
  if (mode === 'pack') return { ...DIFFICULTY_CONFIG.normal, winReward: 15 };
  return DIFFICULTY_CONFIG[difficulty];
}
