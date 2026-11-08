import { describe, expect, it } from 'vitest';
import { evaluateGuess } from '../../src/core/game/letter-evaluator';
import { layoutLetters, mapPhysicalKey, resolveKeyPress } from '../../src/core/keyboard/keyboard-engine';
import { BACKSPACE, ENTER, KEYBOARD_LAYOUTS } from '../../src/core/keyboard/keyboard-layouts';
import { computeKeyStates, keyStateOf } from '../../src/core/keyboard/keyboard-state';
import { ARABIC_ALPHABET } from '../../src/core/localization/arabic/normalize';
import { ENGLISH_ALPHABET } from '../../src/core/localization/english/normalize';
import { getLanguageEngine } from '../../src/core/localization/localization-engine';
import type { GuessRow } from '../../src/types';

const row = (secret: string, guess: string): GuessRow => ({ letters: [...guess], results: evaluateGuess([...secret], [...guess]) });

describe('keyboard layouts', () => {
  it('English is QWERTY with Enter/Backspace on the third row', () => {
    expect(KEYBOARD_LAYOUTS.en[0].join('')).toBe('qwertyuiop');
    expect(KEYBOARD_LAYOUTS.en[1].join('')).toBe('asdfghjkl');
    expect(KEYBOARD_LAYOUTS.en[2]).toEqual([ENTER, ...'zxcvbnm', BACKSPACE]);
  });
  it('each layout covers exactly its alphabet once', () => {
    expect([...layoutLetters('en')].sort()).toEqual([...ENGLISH_ALPHABET].sort());
    expect([...layoutLetters('ar')].sort()).toEqual([...ARABIC_ALPHABET].sort());
    const arFlat = KEYBOARD_LAYOUTS.ar.flat();
    expect(arFlat.length).toBe(new Set(arFlat).size);
  });
  it('Arabic layout has separate Enter and Backspace keys', () => {
    expect(KEYBOARD_LAYOUTS.ar.flat()).toContain(ENTER);
    expect(KEYBOARD_LAYOUTS.ar.flat()).toContain(BACKSPACE);
  });
});

describe('key states', () => {
  it('priority CORRECT > PRESENT > ABSENT, regardless of order', () => {
    const states = computeKeyStates(
      [
        { letters: [...'abcde'], results: ['absent', 'present', 'absent', 'absent', 'absent'] },
        { letters: [...'bacde'], results: ['correct', 'present', 'absent', 'absent', 'absent'] },
      ],
      false,
    );
    expect(keyStateOf(states, 'a')).toBe('present'); // absent → present upgrade
    expect(keyStateOf(states, 'b')).toBe('correct'); // present → correct upgrade
    expect(keyStateOf(states, 'z')).toBe('unused');
  });
  it('a later grey never downgrades an earlier green', () => {
    const states = computeKeyStates(
      [
        { letters: [...'abcde'], results: ['correct', 'absent', 'absent', 'absent', 'absent'] },
        { letters: [...'xxxxa'], results: ['absent', 'absent', 'absent', 'absent', 'absent'] },
      ],
      true,
    );
    expect(keyStateOf(states, 'a')).toBe('correct');
  });
});

describe('EASY dynamic keyboard elimination', () => {
  it('disables only letters proven absent', () => {
    const states = computeKeyStates([row('apple', 'alley')], true);
    expect(keyStateOf(states, 'y')).toBe('disabled');
    expect(keyStateOf(states, 'a')).toBe('correct');
    expect(keyStateOf(states, 'l')).toBe('present'); // one L grey, one yellow → NOT eliminated
    expect(keyStateOf(states, 'e')).toBe('present');
  });
  it('a duplicate grey copy never eliminates a letter present in the word', () => {
    const states = computeKeyStates([row('crane', 'eerie')], true);
    expect(keyStateOf(states, 'e')).toBe('correct');
    expect(keyStateOf(states, 'i')).toBe('disabled');
  });
  it('NORMAL/HARD/EXPERT never disable keys', () => {
    const states = computeKeyStates([row('apple', 'alley')], false);
    expect([...states.values()]).not.toContain('disabled');
    expect(keyStateOf(states, 'y')).toBe('absent');
  });
  it('disabled keys cannot be typed', () => {
    const states = computeKeyStates([row('apple', 'alley')], true);
    expect(resolveKeyPress('y', states)).toBeNull();
    expect(resolveKeyPress('a', states)).toEqual({ type: 'letter', letter: 'a' });
    expect(resolveKeyPress(ENTER, states)).toEqual({ type: 'enter' });
    expect(resolveKeyPress(BACKSPACE, states)).toEqual({ type: 'backspace' });
  });
});

describe('optional physical keyboard mapping', () => {
  it('maps keys per layout and normalizes', () => {
    const en = getLanguageEngine('en');
    const ar = getLanguageEngine('ar');
    expect(mapPhysicalKey('en', 'A', en.normalize)).toBe('a');
    expect(mapPhysicalKey('en', 'Enter', en.normalize)).toBe(ENTER);
    expect(mapPhysicalKey('en', 'Backspace', en.normalize)).toBe(BACKSPACE);
    expect(mapPhysicalKey('en', 'ب', en.normalize)).toBeNull();
    expect(mapPhysicalKey('ar', 'أ', ar.normalize)).toBe('ا');
    expect(mapPhysicalKey('ar', 'x', ar.normalize)).toBeNull();
    expect(mapPhysicalKey('en', 'Shift', en.normalize)).toBeNull();
  });
});
