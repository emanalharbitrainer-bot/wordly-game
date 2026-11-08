import type { Lang } from '../../types';
import { ARABIC_ALPHABET, DEFAULT_ARABIC_RULES, normalizeArabic, type ArabicNormalizationRules } from './arabic/normalize';
import { ENGLISH_ALPHABET, normalizeEnglish } from './english/normalize';
import { splitGraphemes } from './graphemes';

/** Everything the game needs to know about a puzzle language. */
export interface LanguageEngine {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  alphabet: ReadonlySet<string>;
  normalize(word: string): string;
  /** Normalizes then splits into letters (grapheme clusters). */
  toLetters(word: string): string[];
  isLetter(ch: string): boolean;
  /** How a letter is shown on tiles/keys (English is displayed uppercase). */
  display(letter: string): string;
}

function makeEngine(lang: Lang, dir: 'rtl' | 'ltr', alphabet: readonly string[], normalize: (w: string) => string, display: (l: string) => string): LanguageEngine {
  const set = new Set(alphabet);
  return {
    lang,
    dir,
    alphabet: set,
    normalize,
    toLetters: (word) => splitGraphemes(normalize(word)),
    isLetter: (ch) => set.has(normalize(ch)),
    display,
  };
}

const engines: Record<Lang, LanguageEngine> = {
  en: makeEngine('en', 'ltr', ENGLISH_ALPHABET, normalizeEnglish, (l) => l.toUpperCase()),
  ar: makeEngine('ar', 'rtl', ARABIC_ALPHABET, (w) => normalizeArabic(w, DEFAULT_ARABIC_RULES), (l) => l),
};

export function getLanguageEngine(lang: Lang): LanguageEngine {
  return engines[lang];
}

/** Builds an Arabic engine with non-default rules (e.g. for a dictionary that merges ة/ه). */
export function createArabicEngine(rules: ArabicNormalizationRules): LanguageEngine {
  return makeEngine('ar', 'rtl', ARABIC_ALPHABET, (w) => normalizeArabic(w, rules), (l) => l);
}
