import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { useEffect, useMemo } from 'react';
import { useApp } from '../../app/store';

const AR = [...'وردلكمةشسنبحعق'];
const EN = [...'WORDLYGAMEFUNST'];
const KINDS = ['correct', 'present', 'absent', 'ghost', 'ghost'];

/** Ambient menu background: soft letter tiles drifting in depth layers, with pointer/tilt parallax. */
export function FloatingTiles() {
  const lang = useApp((s) => s.prefs.uiLang);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 40, damping: 18 });
  const sy = useSpring(py, { stiffness: 40, damping: 18 });
  const near = { x: useTransform(sx, (v) => v * 28), y: useTransform(sy, (v) => v * 28) };
  const far = { x: useTransform(sx, (v) => v * 10), y: useTransform(sy, (v) => v * 10) };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      px.set(e.clientX / innerWidth - 0.5);
      py.set(e.clientY / innerHeight - 0.5);
    };
    const tilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      px.set(Math.max(-0.5, Math.min(0.5, e.gamma / 60)));
      py.set(Math.max(-0.5, Math.min(0.5, (e.beta - 40) / 60)));
    };
    addEventListener('pointermove', move);
    addEventListener('deviceorientation', tilt);
    return () => {
      removeEventListener('pointermove', move);
      removeEventListener('deviceorientation', tilt);
    };
  }, [px, py]);

  const tiles = useMemo(() => {
    const letters = lang === 'ar' ? AR : EN;
    return Array.from({ length: 16 }, (_, i) => ({
      l: letters[i % letters.length],
      k: KINDS[(i * 7) % KINDS.length],
      x: (i * 61) % 100,
      y: (i * 37 + 11) % 100,
      s: 26 + ((i * 13) % 4) * 9,
      r: ((i * 29) % 40) - 20,
      d: 9 + ((i * 7) % 8),
      far: i % 2 === 0,
    }));
  }, [lang]);

  return (
    <div className="ftiles" aria-hidden>
      {[false, true].map((isFar) => (
        <motion.div key={String(isFar)} className={`ftiles__layer${isFar ? ' is-far' : ''}`} style={isFar ? far : near}>
          {tiles
            .filter((t) => t.far === isFar)
            .map((t, i) => (
              <span
                key={i}
                className={`ftile ftile--${t.k}`}
                style={{ left: `${t.x}%`, top: `${t.y}%`, width: t.s, height: t.s, fontSize: t.s * 0.48, ['--r' as string]: `${t.r}deg`, ['--d' as string]: `${t.d}s`, animationDelay: `${-i * 1.3}s` }}
              >
                {t.l}
              </span>
            ))}
        </motion.div>
      ))}
    </div>
  );
}
