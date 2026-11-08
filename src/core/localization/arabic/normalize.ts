/**
 * Arabic normalization for WORDLY.
 *
 * Rules are explicit and configurable. The SAME rules are applied to the dictionary
 * (at build time, scripts/build-dictionaries.mjs) and to every guess at runtime, so the
 * secret and the guess are always compared in the same space.
 *
 * Design decisions (documented in docs/ARCHITECTURE.md):
 *  - Tashkeel (harakat, tanween, shadda, sukun, dagger alef) and tatweel are NOT letters.
 *    They are combining marks / a stretching glyph, so removing them never changes the
 *    number or order of base letters.
 *  - أ إ آ ٱ are unified to ا by default (common practice for Arabic word games; the
 *    keyboard then needs a single alef key).
 *  - ة and ه stay DIFFERENT letters. ى and ي stay DIFFERENT letters. ؤ ئ ء stay distinct.
 */
export interface ArabicNormalizationRules {
  stripDiacritics: boolean;
  stripTatweel: boolean;
  unifyAlef: boolean;
  /** Merge ة into ه. Off by default — they are distinct letters. */
  unifyTaaMarbuta: boolean;
  /** Merge ى into ي. Off by default — they are distinct letters. */
  unifyAlefMaqsura: boolean;
}

export const DEFAULT_ARABIC_RULES: Readonly<ArabicNormalizationRules> = Object.freeze({
  stripDiacritics: true,
  stripTatweel: true,
  unifyAlef: true,
  unifyTaaMarbuta: false,
  unifyAlefMaqsura: false,
});

/** Harakat, tanween, shadda, sukun, Quranic marks and the superscript (dagger) alef. */
const DIACRITICS = new RegExp('[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06ED]', 'g');
const TATWEEL = new RegExp('\\u0640', 'g');
const ALEF_FORMS = /[أإآٱ]/g;

/** The 33 letters accepted by the game (28 base letters + ء ؤ ئ ة ى). */
export const ARABIC_ALPHABET: readonly string[] = Object.freeze([
  'ا', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ',
  'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ي', 'ء', 'ؤ', 'ئ', 'ة', 'ى',
]);

export function normalizeArabic(input: string, rules: ArabicNormalizationRules = DEFAULT_ARABIC_RULES): string {
  let s = input.trim().normalize('NFC');
  if (rules.stripDiacritics) s = s.replace(DIACRITICS, '');
  if (rules.stripTatweel) s = s.replace(TATWEEL, '');
  if (rules.unifyAlef) s = s.replace(ALEF_FORMS, 'ا');
  if (rules.unifyTaaMarbuta) s = s.replace(/ة/g, 'ه');
  if (rules.unifyAlefMaqsura) s = s.replace(/ى/g, 'ي');
  return s;
}
