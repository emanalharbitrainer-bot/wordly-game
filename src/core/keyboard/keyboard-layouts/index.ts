import type { Lang } from '../../../types';

export const ENTER = '{enter}';
export const BACKSPACE = '{backspace}';
export type KeyId = string;

/**
 * Rows are listed in LOGICAL order. For Arabic the keyboard container is `dir="rtl"`,
 * so the first key of each row renders on the right — matching a familiar Arabic layout.
 */
export const KEYBOARD_LAYOUTS: Readonly<Record<Lang, readonly (readonly KeyId[])[]>> = Object.freeze({
  en: [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    [ENTER, 'z', 'x', 'c', 'v', 'b', 'n', 'm', BACKSPACE],
  ],
  // Standard Arabic (101) layout, minus the ligature key «لا» which is two letters.
  ar: [
    ['ض', 'ص', 'ث', 'ق', 'ف', 'غ', 'ع', 'ه', 'خ', 'ح', 'ج'],
    ['ش', 'س', 'ي', 'ب', 'ل', 'ا', 'ت', 'ن', 'م', 'ك', 'ط'],
    ['ذ', 'ء', 'ؤ', 'ر', 'ى', 'ة', 'و', 'ز', 'ظ', 'د', 'ئ'],
    [ENTER, BACKSPACE],
  ],
});

export function isActionKey(key: KeyId): boolean {
  return key === ENTER || key === BACKSPACE;
}
