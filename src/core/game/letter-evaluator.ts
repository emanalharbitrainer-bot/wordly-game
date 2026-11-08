import type { LetterResult } from '../../types';

/**
 * Two-pass letter evaluation.
 *
 * Pass 1 marks every exact match as `correct` and removes those letters from the pool.
 * Pass 2 walks the remaining guess letters left→right (logical order) and marks a letter
 * `present` only while the secret still has unmatched copies of it; otherwise `absent`.
 *
 * This guarantees the number of correct+present marks for a letter never exceeds the
 * number of times it appears in the secret, so duplicates never leak false information.
 */
export function evaluateGuess(secret: readonly string[], guess: readonly string[]): LetterResult[] {
  if (secret.length !== guess.length) {
    throw new Error(`Length mismatch: secret has ${secret.length} letters, guess has ${guess.length}`);
  }
  const results: LetterResult[] = new Array(guess.length).fill('absent');
  const remaining = new Map<string, number>();

  for (let i = 0; i < secret.length; i++) {
    if (guess[i] === secret[i]) results[i] = 'correct';
    else remaining.set(secret[i], (remaining.get(secret[i]) ?? 0) + 1);
  }
  for (let i = 0; i < guess.length; i++) {
    if (results[i] === 'correct') continue;
    const left = remaining.get(guess[i]) ?? 0;
    if (left > 0) {
      results[i] = 'present';
      remaining.set(guess[i], left - 1);
    }
  }
  return results;
}

export function isWinningResult(results: readonly LetterResult[]): boolean {
  return results.length > 0 && results.every((r) => r === 'correct');
}
