import { useEffect } from 'react';
import { mapPhysicalKey } from '../core/keyboard/keyboard-engine';
import type { KeyId } from '../core/keyboard/keyboard-layouts';
import type { LanguageEngine } from '../core/localization/localization-engine';

/** Optional hardware-keyboard input. Only attached when the player enables it in Settings. */
export function usePhysicalKeyboard(enabled: boolean, engine: LanguageEngine | null, onKey: (k: KeyId) => void) {
  useEffect(() => {
    if (!enabled || !engine) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName === 'BUTTON') return; // let focused buttons work
      const key = mapPhysicalKey(engine.lang, e.key, engine.normalize);
      if (!key) return;
      e.preventDefault();
      onKey(key);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, engine, onKey]);
}
