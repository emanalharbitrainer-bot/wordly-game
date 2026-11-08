import { animate, motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { flameColors, flameTier } from '../../core/progress/progress-engine';
import type { Difficulty } from '../../types';
import { haptic } from '../assistant/assistant-store';
import { sfx } from './sfx';

const OUTER = 'M50 4 C60 24 84 44 84 84 C84 112 69 132 50 132 C31 132 16 112 16 84 C16 62 30 52 35 30 C41 44 44 52 49 56 C53 40 47 22 50 4 Z';
const MID = 'M50 30 C57 46 74 60 74 90 C74 112 63 126 50 126 C37 126 26 112 26 90 C26 74 36 66 40 52 C44 62 46 66 50 70 C53 58 48 44 50 30 Z';
const CORE = 'M50 62 C55 74 64 84 64 102 C64 116 58 124 50 124 C42 124 36 116 36 102 C36 92 42 86 44 78 C47 84 48 88 50 90 C52 82 49 72 50 62 Z';
const SIDE = 'M50 40 C56 56 66 70 64 96 C62 116 56 126 50 126 C44 126 38 116 38 98 C38 80 46 68 50 40 Z';

interface Spark {
  id: number;
  x: number;
  y: number;
  r: number;
  d: number;
}

/**
 * The living streak flame. Its size, ember count, flicker speed and decorations grow with the streak
 * tier (1 day … 100+ days); its palette follows the difficulty won. Touch it: it flares up, throws
 * sparks and leans toward your finger.
 */
export function Flame({ count, difficulty, size = 160, interactive = true, showCount = true, dim = false }: { count: number; difficulty: Difficulty | null; size?: number; interactive?: boolean; showCount?: boolean; dim?: boolean }) {
  const uid = useId().replace(/[:]/g, '');
  const tier = flameTier(count);
  const c = flameColors(count > 0 ? difficulty : null);
  const lean = useMotionValue(0);
  const leanS = useSpring(lean, { stiffness: 120, damping: 12 });
  const skew = useTransform(leanS, (v) => `skewX(${v * -10}deg)`);
  const flare = useMotionValue(1);
  const flareS = useSpring(flare, { stiffness: 260, damping: 11 });
  const [sparks, setSparks] = useState<Spark[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  const embers = useMemo(
    () => Array.from({ length: tier.embers }, (_, i) => ({ x: 22 + ((i * 37) % 56), dur: 1.6 + ((i * 13) % 10) / 6, delay: (i * 0.37) % 2.4, drift: ((i % 5) - 2) * 7, r: 1.2 + (i % 3) * 0.7 })),
    [tier.embers],
  );

  const poke = () => {
    if (!interactive) return;
    haptic([8, 30, 12]);
    sfx.whoosh(tier.tier);
    flare.set(1.28);
    setTimeout(() => flare.set(1), 140);
    const n = 8 + tier.tier * 2;
    const base = ++seq.current * 100;
    const fresh = Array.from({ length: n }, (_, i) => ({ id: base + i, x: (Math.random() - 0.5) * 140, y: -40 - Math.random() * 90, r: 2 + Math.random() * 3, d: 0.6 + Math.random() * 0.5 }));
    setSparks((s) => [...s, ...fresh].slice(-60));
    setTimeout(() => setSparks((s) => s.filter((x) => x.id < base || x.id >= base + n)), 1300);
  };

  const move = (e: React.PointerEvent) => {
    if (!interactive || !ref.current) return;
    const b = ref.current.getBoundingClientRect();
    lean.set(Math.max(-1, Math.min(1, ((e.clientX - b.left) / b.width - 0.5) * 2)));
  };

  const scale = tier.scale;
  return (
    <motion.div
      ref={ref}
      className={`flame t${tier.tier}${dim ? ' flame--dim' : ''}${count === 0 ? ' flame--cold' : ''}`}
      style={{ width: size, height: size * 1.2, ['--speed' as string]: `${1 / tier.speed}`, ['--glow' as string]: c.glow, scale: flareS }}
      onPointerDown={poke}
      onPointerMove={move}
      onPointerLeave={() => lean.set(0)}
      role={interactive ? 'button' : 'img'}
      aria-label={`${count}`}
      tabIndex={interactive ? 0 : -1}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && poke()}
      whileHover={interactive ? { y: -2 } : undefined}
    >
      <div className="flame__glow" />
      {tier.tier >= 6 && <div className="flame__corona" />}
      {tier.tier >= 5 && <div className="flame__ring" />}
      <svg viewBox="-16 -26 132 170" className="flame__svg" aria-hidden>
        <defs>
          <linearGradient id={`fo${uid}`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor={c.outer} />
            <stop offset="0.7" stopColor={c.mid} />
            <stop offset="1" stopColor={c.mid} stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id={`fm${uid}`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor={c.mid} />
            <stop offset="1" stopColor={c.core} />
          </linearGradient>
          <radialGradient id={`fc${uid}`} cx="0.5" cy="0.75" r="0.6">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor={c.core} />
          </radialGradient>
        </defs>
        <motion.g style={{ transform: skew, transformOrigin: '50px 132px' }}>
          <g transform={`translate(50 132) scale(${scale}) translate(-50 -132)`}>
            {tier.tier >= 4 && (
              <>
                <path className="flame__side flame__side--l" d={SIDE} fill={`url(#fo${uid})`} />
                <path className="flame__side flame__side--r" d={SIDE} fill={`url(#fo${uid})`} />
              </>
            )}
            <path className="flame__outer" d={OUTER} fill={`url(#fo${uid})`} />
            <path className="flame__mid" d={MID} fill={`url(#fm${uid})`} />
            <path className="flame__core" d={CORE} fill={`url(#fc${uid})`} />
          </g>
          {embers.map((e, i) => (
            <circle key={i} className="flame__ember" cx={e.x} cy={120} r={e.r} fill={c.core} style={{ ['--dur' as string]: `${e.dur}s`, ['--delay' as string]: `${e.delay}s`, ['--drift' as string]: `${e.drift}px` }} />
          ))}
        </motion.g>
      </svg>
      <div className="flame__sparks" aria-hidden>
        {sparks.map((s) => (
          <motion.span
            key={s.id}
            className="flame__spark"
            style={{ width: s.r * 2, height: s.r * 2, background: c.core, boxShadow: `0 0 8px ${c.mid}` }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: s.x, y: s.y, opacity: 0, scale: 0.3 }}
            transition={{ duration: s.d, ease: [0.2, 0.8, 0.3, 1] }}
          />
        ))}
      </div>
      {showCount && (
        <div className="flame__count" style={{ fontSize: size * 0.2 }}>
          <CountNumber n={count} />
        </div>
      )}
    </motion.div>
  );
}

function CountNumber({ n }: { n: number }) {
  const [shown, setShown] = useState(n);
  const prev = useRef(n);
  useEffect(() => {
    if (prev.current === n) return;
    const ctl = animate(prev.current, n, { duration: 0.9, ease: 'easeOut', onUpdate: (v) => setShown(Math.round(v)) });
    prev.current = n;
    return () => ctl.stop();
  }, [n]);
  return <span>{shown}</span>;
}

/** Small inline flame (menu pill, friend cards). */
export function MiniFlame({ count, difficulty, size = 22 }: { count: number; difficulty: Difficulty | null; size?: number }) {
  const c = flameColors(count > 0 ? difficulty : null);
  return (
    <svg viewBox="0 0 100 140" width={size} height={size * 1.4} className={`mini-flame${count > 0 ? ' is-lit' : ''}`} aria-hidden>
      <path d={OUTER} fill={c.outer} />
      <path d={MID} fill={c.mid} />
      <path d={CORE} fill={c.core} />
    </svg>
  );
}
