import { formatNumber } from '../../core/localization/ui-strings';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { levelInfo } from '../../core/progress/progress-engine';
import { spring } from '../../styles/motion';
import type { Lang } from '../../types';
import { colorOf } from './profile-store';

/** Avatar bubble with an animated level ring (SVG stroke) and a level badge. */
export function AvatarRing({ avatar, color, xp, size = 96, showLevel = true, pulse = false }: { avatar: string; color: string; xp: number; size?: number; showLevel?: boolean; pulse?: boolean }) {
  const li = levelInfo(xp);
  const r = 46;
  const C = 2 * Math.PI * r;
  const col = colorOf(color);
  return (
    <div className={`av-ring${pulse ? ' av-ring--pulse' : ''}`} style={{ width: size, height: size, ['--av' as string]: col }}>
      <svg viewBox="0 0 100 100" className="av-ring__svg" aria-hidden>
        <circle cx="50" cy="50" r={r} className="av-ring__track" />
        <motion.circle
          cx="50"
          cy="50"
          r={r}
          className="av-ring__bar"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C * (1 - li.pct) }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
          style={{ stroke: col }}
        />
      </svg>
      <motion.div className="av-ring__face" style={{ fontSize: size * 0.44 }} whileTap={{ scale: 0.88, rotate: -8 }} transition={spring.bouncy}>
        {avatar}
      </motion.div>
      {showLevel && (
        <motion.div className="av-ring__lvl" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...spring.bouncy, delay: 0.5 }} style={{ background: col }}>
          {li.level}
        </motion.div>
      )}
    </div>
  );
}

/** XP bar that fills from `from` to `to` (crossing level boundaries) — used after a round. */
export function XpBar({ from, to, lang, compact = false }: { from: number; to: number; lang: Lang; compact?: boolean }) {
  const mv = useMotionValue(from);
  const [v, setV] = useState(Math.round(from));
  useEffect(() => {
    // re-render only when the displayed integer changes, not on every animation frame
    const c = animate(mv, to, { duration: 1.4, ease: [0.22, 1, 0.36, 1], delay: 0.4, onUpdate: (x) => setV(Math.round(x)) });
    return () => c.stop();
  }, [mv, to]);
  const li = levelInfo(v);
  const rtl = lang === 'ar';
  // clip-path repaints only the bar; animating width re-laid-out the whole sheet every frame
  const clip = useTransform(mv, (x) => {
    const gap = 100 - Math.min(100, levelInfo(x).pct * 100);
    return rtl ? `inset(0 0 0 ${gap}% round 999px)` : `inset(0 ${gap}% 0 0 round 999px)`;
  });
  return (
    <div className={`xpbar${compact ? ' xpbar--compact' : ''}`}>
      <div className="xpbar__head">
        <span className="xpbar__lvl">
          {lang === 'ar' ? 'المستوى' : 'Level'} <AnimatedInt n={li.level} lang={lang} />
        </span>
        <span className="xpbar__title">{li.title[lang]}</span>
      </div>
      <div className="xpbar__track">
        <motion.div className="xpbar__fill" style={{ width: '100%', clipPath: clip }} />
        <div className="xpbar__shine" />
      </div>
      {!compact && (
        <div className="xpbar__foot" dir="ltr">
          {Math.round(li.into)} / {li.span} XP
        </div>
      )}
    </div>
  );
}

function AnimatedInt({ n, lang }: { n: number; lang: Lang }) {
  const prev = useRef(n);
  const changed = prev.current !== n;
  prev.current = n;
  return (
    <motion.b key={n} initial={changed ? { scale: 1.8, color: 'var(--gold)' } : false} animate={{ scale: 1, color: 'var(--ink)' }} transition={spring.bouncy} style={{ display: 'inline-block' }}>
      {formatNumber(n, lang)}
    </motion.b>
  );
}
