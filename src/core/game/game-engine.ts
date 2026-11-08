import type { LetterResult } from '../../types';
import type { DifficultyRules } from '../difficulty/difficulty-config';
import type { WordDictionary } from '../words/word-engine';
import { applyEvaluation } from './game-session';
import type { GameSession } from './game-state';
import { validateGuess, type GuessError } from './guess-validator';
import { evaluateGuess } from './letter-evaluator';

/** Source of truth for letter results. Local modes know the secret; the daily challenge asks the server. */
export interface Evaluator {
  evaluate(letters: readonly string[]): Promise<{ results: LetterResult[]; answer?: string }>;
}

export class LocalEvaluator implements Evaluator {
  constructor(private readonly secret: readonly string[]) {}
  async evaluate(letters: readonly string[]) {
    return { results: evaluateGuess(this.secret, letters) };
  }
}

export type SubmitOutcome =
  | { ok: true; session: GameSession; results: LetterResult[] }
  | { ok: false; error: GuessError | { code: 'busy' } | { code: 'evaluation_failed'; message: string } };

/**
 * Orchestrates one guess: validate → evaluate → apply. UI-agnostic; it never touches
 * the DOM or storage. A guard prevents a second submission while one is in flight
 * (double taps, repeated Enter presses, slow network on the daily challenge).
 */
export class GameEngine {
  private inFlight = false;

  constructor(
    private readonly dict: WordDictionary,
    private readonly rules: DifficultyRules,
    private readonly evaluator: Evaluator,
  ) {}

  get busy(): boolean {
    return this.inFlight;
  }

  async submit(session: GameSession): Promise<SubmitOutcome> {
    if (this.inFlight) return { ok: false, error: { code: 'busy' } };
    const check = validateGuess(session, this.dict, this.rules);
    if (!check.ok) return { ok: false, error: check.error };
    this.inFlight = true;
    try {
      const { results, answer } = await this.evaluator.evaluate(check.letters);
      let next = applyEvaluation(session, check.letters, results);
      if (answer && next !== session) next = { ...next, revealedAnswer: answer };
      return { ok: true, session: next, results };
    } catch (e) {
      return { ok: false, error: { code: 'evaluation_failed', message: e instanceof Error ? e.message : String(e) } };
    } finally {
      this.inFlight = false;
    }
  }
}
