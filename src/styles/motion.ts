import type { Transition, Variants } from 'motion/react';

/**
 * Motion language for WORDLY. Every animated component pulls its timing from here so
 * the product moves with one consistent voice:
 *  - UI chrome: quick, decelerating (easeOut) — never in the player's way.
 *  - Game feedback: tactile springs (tile pop, key press, bounce).
 *  - Celebrations: longer, staggered sequences that only play at round end.
 */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

export const spring = {
  snappy: { type: 'spring', stiffness: 520, damping: 30, mass: 0.7 } satisfies Transition,
  soft: { type: 'spring', stiffness: 260, damping: 28 } satisfies Transition,
  bouncy: { type: 'spring', stiffness: 380, damping: 14 } satisfies Transition,
  sheet: { type: 'spring', stiffness: 340, damping: 34 } satisfies Transition,
};

/** Page transitions: a short horizontal drift that follows reading direction. */
export const screenVariants: Variants = {
  // transform + opacity only: both run on the compositor. (A full-screen blur here cost
  // whole frames on every navigation on phones.)
  enter: (dir: number) => ({ opacity: 0, x: 28 * dir }),
  center: { opacity: 1, x: 0, transition: { duration: 0.3, ease: EASE_OUT } },
  exit: (dir: number) => ({ opacity: 0, x: -20 * dir, transition: { duration: 0.18, ease: EASE_IN_OUT } }),
};

/** Staggered entrance for lists of cards/buttons inside a screen. */
export const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.08 } },
};
export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: EASE_OUT } },
};

/** Learning card: letters cascade in, then the content blocks follow. */
export const learnContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.15 } },
};
export const learnLetters: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};
export const learnLetter: Variants = {
  hidden: { opacity: 0, y: 18, rotateX: -70 },
  show: { opacity: 1, y: 0, rotateX: 0, transition: spring.bouncy },
};
export const learnBlock: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT } },
};

/** Wrong word: a small, damped shake (≈380ms) — informative, not punishing. */
export const SHAKE_X = [0, -9, 8, -6, 5, -3, 2, 0];
export const SHAKE_TRANSITION: Transition = { duration: 0.38, ease: 'easeOut' };
