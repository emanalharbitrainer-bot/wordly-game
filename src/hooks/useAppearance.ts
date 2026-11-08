import { useReducedMotion } from 'motion/react';
import { useEffect } from 'react';
import { useApp } from '../app/store';
import { activeSeason } from '../core/season/season';
import { track } from '../services/v3/v3-client';

let opened = false;

/** Applies theme, contrast, motion and document direction/lang from preferences. */
export function useAppearance(): { reduced: boolean } {
  const prefs = useApp((s) => s.prefs);
  const systemReduced = useReducedMotion() ?? false;
  const reduced = prefs.reducedMotion === 'on' || (prefs.reducedMotion === 'system' && systemReduced);

  useEffect(() => {
    const root = document.documentElement;
    if (prefs.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', prefs.theme);
    root.setAttribute('data-contrast', prefs.highContrast ? 'high' : 'normal');
    root.setAttribute('data-motion', reduced ? 'reduced' : 'full');
    root.lang = prefs.uiLang;
    const season = activeSeason();
    if (season) root.setAttribute('data-season', season.id);
    else root.removeAttribute('data-season');
    if (!opened) {
      opened = true;
      track('app_open', prefs.uiLang);
    }
    root.dir = prefs.uiLang === 'ar' ? 'rtl' : 'ltr';
    const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111214' : '#f4f1ea');
  }, [prefs.theme, prefs.highContrast, prefs.uiLang, reduced]);

  return { reduced };
}
