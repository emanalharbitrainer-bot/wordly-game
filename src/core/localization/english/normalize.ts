export const ENGLISH_ALPHABET: readonly string[] = Object.freeze('abcdefghijklmnopqrstuvwxyz'.split(''));

/** English answers and guesses are compared in lowercase ASCII. */
export function normalizeEnglish(input: string): string {
  return input.trim().normalize('NFC').toLowerCase();
}
