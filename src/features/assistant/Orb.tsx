import { AnimatePresence, motion } from 'motion/react';
import { useMemo } from 'react';
import { spring } from '../../styles/motion';
import { useAssistant } from './assistant-store';

const TILE_COLORS = ['var(--correct)', 'var(--present)', 'var(--absent)', 'var(--correct)'];

/**
 * The living core of the assistant: four WORDLY tiles inside a liquid-glass sphere.
 * Idle → the tiles breathe; thinking → they flip like a reveal; streaming → they pulse;
 * celebrate / sad / alert → one-shot reactions.
 */
export function OrbCore({ size = 52 }: { size?: number }) {
  const phase = useAssistant((s) => s.phase);
  const mood = useAssistant((s) => s.mood);
  const moodTick = useAssistant((s) => s.moodTick);
  const t = size * 0.27;

  const tileAnim = (i: number) => {
    if (phase === 'thinking') return { animate: { rotateX: [0, 180, 360], scale: [1, 0.9, 1] }, transition: { duration: 0.9, repeat: Infinity, delay: i * 0.13, ease: 'easeInOut' as const } };
    if (phase === 'streaming') return { animate: { scale: [1, 1.14, 1] }, transition: { duration: 0.6, repeat: Infinity, delay: i * 0.1 } };
    if (document.documentElement.dataset.perf === 'lite') return { animate: { scale: 1 }, transition: { duration: 0 } };
    return { animate: { scale: [1, 0.84, 1], rotateY: [0, 0, 180, 180, 360] }, transition: { duration: 5.2, repeat: Infinity, delay: i * 0.4, ease: 'easeInOut' as const } };
  };

  const body =
    mood === 'celebrate'
      ? { scale: [1, 1.28, 0.94, 1.06, 1], rotate: [0, -14, 10, -4, 0] }
      : mood === 'sad'
        ? { rotate: [0, -8, 6, -3, 0], y: [0, 2, 0] }
        : mood === 'alert'
          ? { scale: [1, 1.12, 1] }
          : { scale: 1, rotate: 0 };

  return (
    <motion.span key={moodTick} className={`orb-core is-${phase}`} style={{ width: size, height: size }} animate={body} transition={{ duration: 0.7 }}>
      <span className="orb-core__aura" />
      <span className="orb-core__grid" style={{ gap: size * 0.06 }}>
        {TILE_COLORS.map((c, i) => {
          const a = tileAnim(i);
          return <motion.span key={`${phase}-${i}`} className="orb-core__tile" style={{ width: t, height: t, background: c, borderRadius: t * 0.24 }} animate={a.animate} transition={a.transition} />;
        })}
      </span>
      <span className="orb-core__shine" />
    </motion.span>
  );
}

/** Mini tiles that burst out of the orb when the player wins. */
export function Burst({ tick }: { tick: number }) {
  const parts = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
        const d = 46 + Math.random() * 38;
        return { x: Math.cos(a) * d, y: Math.sin(a) * d - 18, r: Math.random() * 300 - 150, c: TILE_COLORS[i % 3], s: 7 + Math.random() * 6 };
      }),
    [tick], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <span className="orb-burst" aria-hidden>
      {parts.map((p, i) => (
        <motion.i key={`${tick}-${i}`} style={{ background: p.c, width: p.s, height: p.s }} initial={{ x: 0, y: 0, scale: 0.4, opacity: 1, rotate: 0 }} animate={{ x: p.x, y: p.y, scale: 1, opacity: 0, rotate: p.r }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }} />
      ))}
    </span>
  );
}

export function NudgeBubble({ bottom, compact }: { bottom: number; compact: boolean }) {
  const nudge = useAssistant((s) => s.nudge);
  const dismiss = useAssistant((s) => s.dismissNudge);
  const openPanel = useAssistant((s) => s.openPanel);
  return (
    <AnimatePresence>
      {nudge && (
        <motion.div
          key={nudge.id}
          className="ai-nudge"
          style={{ bottom: bottom + (compact ? 2 : 7), right: compact ? 58 : 74 }}
          initial={{ opacity: 0, scale: 0.6, x: 24 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          exit={{ opacity: 0, scale: 0.7, x: 16 }}
          transition={spring.bouncy}
        >
          <button type="button" className="ai-nudge__body" onClick={() => openPanel(nudge.prompt, { display: nudge.display, intent: nudge.intent })} dir="auto">
            {nudge.text}
          </button>
          <button type="button" className="ai-nudge__x" aria-label="dismiss" onClick={dismiss}>
            ✕
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
