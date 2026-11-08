import type { KeyState, Lang } from '../../types';
import { BACKSPACE, ENTER, KEYBOARD_LAYOUTS, isActionKey, type KeyId } from './keyboard-layouts';

export type KeyboardAction = { type: 'letter'; letter: string } | { type: 'enter' } | { type: 'backspace' };

/**
 * Translates a key press into a game action. Disabled keys produce nothing, so an
 * eliminated letter can never be typed — regardless of how the press was generated.
 */
export function resolveKeyPress(key: KeyId, states: Map<string, KeyState>): KeyboardAction | null {
  if (key === ENTER) return { type: 'enter' };
  if (key === BACKSPACE) return { type: 'backspace' };
  if (states.get(key) === 'disabled') return null;
  return { type: 'letter', letter: key };
}

/**
 * Optional physical-keyboard support (off by default). Maps a KeyboardEvent.key to a
 * layout key, or null when the key does not belong to the active layout.
 */
export function mapPhysicalKey(lang: Lang, eventKey: string, normalize: (s: string) => string): KeyId | null {
  if (eventKey === 'Enter') return ENTER;
  if (eventKey === 'Backspace' || eventKey === 'Delete') return BACKSPACE;
  if (eventKey.length > 2) return null;
  const letter = normalize(eventKey);
  return layoutLetters(lang).has(letter) ? letter : null;
}

const letterCache = new Map<Lang, Set<string>>();
export function layoutLetters(lang: Lang): Set<string> {
  let set = letterCache.get(lang);
  if (!set) {
    set = new Set(KEYBOARD_LAYOUTS[lang].flat().filter((k) => !isActionKey(k)));
    letterCache.set(lang, set);
  }
  return set;
}
