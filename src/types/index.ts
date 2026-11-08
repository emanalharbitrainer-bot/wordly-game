/** Shared domain types. Kept free of any runtime code so every layer can import them. */

export type Lang = 'ar' | 'en';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';
/** archive = a past daily (server-evaluated) · pack = themed word pack · speed = 2-minute run · tutorial = guided first round */
export type GameMode = 'classic' | 'daily' | 'infinite' | 'custom' | 'archive' | 'pack' | 'speed' | 'tutorial';

/** Result of evaluating a single letter of a submitted guess. */
export type LetterResult = 'correct' | 'present' | 'absent';

/** State of a key on the virtual keyboard. */
export type KeyState = 'unused' | 'correct' | 'present' | 'absent' | 'disabled';

export type GameStatus = 'IDLE' | 'PLAYING' | 'WON' | 'LOST' | 'PAUSED' | 'COMPLETED';

export interface GuessRow {
  letters: string[];
  results: LetterResult[];
}

export type HintType = 'category' | 'meaning' | 'letter' | 'position' | 'root';

export interface HintReveal {
  type: HintType;
  /** Text payload for category / meaning hints. */
  text?: string;
  /** Letter + zero-based position for letter / position hints. */
  letter?: string;
  position?: number;
}

export interface AnswerEntry {
  /** Normalized word (what the engine compares). */
  w: string;
  /** Display form (may contain hamza forms etc.). */
  d: string;
  /** Category (in the word's language). */
  c: string;
  /** Short meaning (in the word's language). */
  m: string;
  /** Arabic meaning of an English word (learning card). */
  t?: string;
  /** Pronunciation: IPA for English, fully vocalized form for Arabic. */
  p?: string;
  /** Example sentence. */
  e?: string;
  /** Arabic root (letters separated by spaces) or «معرّب» for borrowed words. */
  r?: string;
}

export interface GameResult {
  id: string;
  mode: GameMode;
  difficulty: Difficulty;
  lang: Lang;
  won: boolean;
  /** Number of guesses used. */
  attempts: number;
  maxAttempts: number;
  hintsUsed: number;
  /** ISO timestamp when the game finished. */
  finishedAt: string;
  /** Challenge date (YYYY-MM-DD) for daily games. */
  dailyDate?: string;
}
