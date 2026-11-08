import { describe, expect, it } from 'vitest';
import { DAILY_RULES, DIFFICULTY_CONFIG, getRules } from '../../src/core/difficulty/difficulty-config';
import { checkConstraints, deriveKnowledge } from '../../src/core/difficulty/difficulty-engine';
import { evaluateGuess } from '../../src/core/game/letter-evaluator';
import type { GuessRow } from '../../src/types';

const row = (secret: string, guess: string): GuessRow => ({ letters: [...guess], results: evaluateGuess([...secret], [...guess]) });

describe('difficulty config', () => {
  it('matches the product matrix', () => {
    expect(DIFFICULTY_CONFIG.easy).toMatchObject({ maxAttempts: 6, keyboardElimination: true, constraints: 'none' });
    expect(DIFFICULTY_CONFIG.normal).toMatchObject({ maxAttempts: 6, keyboardElimination: false, maxHints: 1, constraints: 'none' });
    expect(DIFFICULTY_CONFIG.hard).toMatchObject({ maxAttempts: 5, keyboardElimination: false, maxHints: 0, constraints: 'hard' });
    expect(DIFFICULTY_CONFIG.expert).toMatchObject({ maxAttempts: 4, keyboardElimination: false, maxHints: 0, constraints: 'expert' });
  });
  it('only EASY eliminates keys', () => {
    expect(Object.values(DIFFICULTY_CONFIG).filter((r) => r.keyboardElimination).map((r) => r.id)).toEqual(['easy']);
  });
  it('hints are disabled in HARD, EXPERT and the daily challenge', () => {
    expect(DIFFICULTY_CONFIG.hard.allowedHints).toHaveLength(0);
    expect(DIFFICULTY_CONFIG.expert.allowedHints).toHaveLength(0);
    expect(DAILY_RULES.maxHints).toBe(0);
  });
  it('each difficulty draws from its own word pool', () => {
    expect(new Set(Object.values(DIFFICULTY_CONFIG).map((r) => r.wordPool)).size).toBe(4);
  });
  it('daily mode overrides the selected difficulty', () => {
    expect(getRules('expert', 'daily')).toBe(DAILY_RULES);
    expect(getRules('hard', 'infinite')).toBe(DIFFICULTY_CONFIG.hard);
  });
});

describe('deriveKnowledge', () => {
  it('learns fixed, min/max counts and forbidden positions', () => {
    const k = deriveKnowledge([row('apple', 'alley')]);
    expect(k.fixed.get(0)).toBe('a');
    expect(k.minCount.get('l')).toBe(1);
    expect(k.maxCount.get('l')).toBe(1); // second L was grey → exactly one L
    expect(k.maxCount.get('y')).toBe(0);
    expect([...k.forbidden.get('l')!]).toEqual([1]);
    expect([...k.forbidden.get('e')!]).toEqual([3]);
  });
});

describe('HARD constraints', () => {
  const rows = [row('apple', 'alley')]; // A green@0, L yellow@1, E yellow@3
  it('accepts a guess that respects all clues', () => {
    expect(checkConstraints('hard', rows, [...'ample'])).toBeNull();
  });
  it('rejects moving a green letter', () => {
    expect(checkConstraints('hard', rows, [...'lapel'])).toMatchObject({ code: 'must_keep_correct', letter: 'a', position: 0 });
  });
  it('rejects dropping a yellow letter', () => {
    expect(checkConstraints('hard', rows, [...'acorn'])).toMatchObject({ code: 'must_include', letter: 'l' });
  });
  it('rejects re-using a yellow letter in the same position', () => {
    expect(checkConstraints('hard', rows, [...'aloes'])).toMatchObject({ code: 'must_move_present', letter: 'l', position: 1 });
  });
  it('still allows grey letters in HARD', () => {
    expect(checkConstraints('hard', rows, [...'ayelp'])).toBeNull(); // re-uses the grey Y — allowed in HARD
    expect(checkConstraints('expert', rows, [...'ayelp'])).toMatchObject({ code: 'excluded_letter', letter: 'y' });
  });
  it('requires duplicates when two copies were confirmed', () => {
    const r = [row('apple', 'pupal')]; // two P confirmed
    expect(checkConstraints('hard', r, [...'paper'])).toMatchObject({ code: 'must_include', letter: 'l' });
    expect(checkConstraints('hard', r, [...'aplop'])).not.toMatchObject({ code: 'must_include', letter: 'p' });
  });
  it('NONE never blocks', () => {
    expect(checkConstraints('none', rows, [...'zzzzz'])).toBeNull();
  });
});

describe('EXPERT constraints', () => {
  const rows = [row('apple', 'alley')];
  it('rejects letters proven absent', () => {
    expect(checkConstraints('expert', rows, [...'alsey'].reverse().reverse())).toMatchObject({ code: 'must_move_present' });
    expect(checkConstraints('expert', rows, [...'abeyl'])).toMatchObject({ code: 'excluded_letter', letter: 'y' });
  });
  it('rejects exceeding a known exact count', () => {
    expect(checkConstraints('expert', rows, [...'aelll'])).toMatchObject({ code: 'too_many', letter: 'l', count: 1 });
  });
  it('accepts a fully consistent guess', () => {
    expect(checkConstraints('expert', rows, [...'ample'])).toBeNull();
  });
});
