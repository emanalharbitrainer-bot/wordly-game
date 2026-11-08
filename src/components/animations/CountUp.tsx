import { animate, useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { formatNumber } from '../../core/localization/ui-strings';
import type { Lang } from '../../types';

function format(v: number, lang: Lang, decimals: number, suffix: string): string {
  const text = decimals ? v.toFixed(decimals) : String(Math.round(v));
  return (lang === 'ar' ? formatNumber(Number(text), lang).replace('.', '٫') : text) + suffix;
}

/**
 * Animated number that counts up when it scrolls into view.
 * Writes straight to the DOM (no React render per frame) and only when the visible text changes.
 */
export function CountUp({ value, lang, suffix = '', decimals = 0 }: { value: number; lang: Lang; suffix?: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const final = format(value, lang, decimals, suffix);
    if (!inView) return;
    if (reduce) {
      el.textContent = final;
      return;
    }
    let last = '';
    const controls = animate(0, value, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        const t = format(v, lang, decimals, suffix);
        if (t !== last) el.textContent = last = t;
      },
      onComplete: () => (el.textContent = final),
    });
    return () => controls.stop();
  }, [inView, value, reduce, lang, decimals, suffix]);

  return (
    <span ref={ref} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {format(reduce ? value : 0, lang, decimals, suffix)}
    </span>
  );
}
