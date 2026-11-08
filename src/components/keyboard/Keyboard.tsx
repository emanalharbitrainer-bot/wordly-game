import { memo } from 'react';
import { BACKSPACE, ENTER, KEYBOARD_LAYOUTS, type KeyId } from '../../core/keyboard/keyboard-layouts';
import type { LanguageEngine } from '../../core/localization/localization-engine';
import type { KeyState } from '../../types';
import { Icon } from '../layout/Icon';

interface KeyboardProps {
  engine: LanguageEngine;
  states: Map<string, KeyState>;
  onKey: (key: KeyId) => void;
  enterLabel: string;
  deleteLabel: string;
  stateLabel: (s: KeyState) => string;
}

const PRESS: Keyframe[] = [{ transform: 'scale(1)' }, { transform: 'scale(0.86) translateY(1px)', offset: 0.35 }, { transform: 'scale(1)' }];
const PRESS_OPTS: KeyframeAnimationOptions = { duration: 170, easing: 'cubic-bezier(.2,.8,.3,1)' };

/**
 * Ghost-click guard. A key acts on pointerdown, so by the time the browser fires that tap's
 * `click` the screen may have changed under the finger (e.g. Enter on the winning word swaps the
 * keyboard for "Play again"), and the click would hit the new button. Swallow that one click.
 */
let guardUntil = 0;
function armClickGuard() {
  guardUntil = performance.now() + 700;
}
if (typeof window !== 'undefined') {
  window.addEventListener(
    'click',
    (e) => {
      if (performance.now() > guardUntil) return;
      guardUntil = 0;
      const t = e.target as Element | null;
      if (t?.closest?.('.kb')) return; // a click on the keyboard itself is harmless (handled as detail 0 only)
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
}

/** Press squash on the compositor (Web Animations) — no React work, no layout. */
function squash(el: HTMLElement) {
  if (document.documentElement.dataset.motion === 'reduced') return;
  el.animate?.(PRESS, PRESS_OPTS);
}

/**
 * In-game virtual keyboard. Built only from <button>s — there is no text input anywhere,
 * so the OS keyboard (iOS / Android / tablets) can never appear.
 * It only re-renders when key colours change (states map identity), never per typed letter.
 * pointerdown is used instead of click for instant response on touch devices.
 */
export const Keyboard = memo(function Keyboard({ engine, states, onKey, enterLabel, deleteLabel, stateLabel }: KeyboardProps) {
  const rows = KEYBOARD_LAYOUTS[engine.lang];
  return (
    <div className="kb" dir={engine.dir} data-lang={engine.lang} role="group" aria-label="Keyboard">
      {rows.map((row, r) => (
        <div className="kb__row" key={r}>
          {row.map((key) => {
            const isEnter = key === ENTER;
            const isDel = key === BACKSPACE;
            const state = isEnter || isDel ? 'unused' : (states.get(key) ?? 'unused');
            const disabled = state === 'disabled';
            const label = isEnter ? enterLabel : isDel ? deleteLabel : `${engine.display(key)}${state !== 'unused' ? `, ${stateLabel(state)}` : ''}`;
            return (
              <button
                key={key}
                type="button"
                className={`key key--${state}${isEnter || isDel ? ' key--wide' : ''}`}
                aria-label={label}
                aria-disabled={disabled || undefined}
                tabIndex={disabled ? -1 : 0}
                // One input per press: pointerdown handles touch, pen and mouse instantly;
                // onClick only handles keyboard activation (Enter/Space on a focused key,
                // which fires a click with detail === 0). Taps never reach the click path.
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  if (disabled) return;
                  armClickGuard();
                  squash(e.currentTarget);
                  onKey(key);
                }}
                onClick={(e) => {
                  if (e.detail === 0 && !disabled) {
                    squash(e.currentTarget);
                    onKey(key);
                  }
                }}
              >
                {isDel ? <Icon name="backspace" className={engine.dir === 'rtl' ? 'flip-rtl' : undefined} /> : isEnter ? enterLabel : engine.display(key)}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
});
