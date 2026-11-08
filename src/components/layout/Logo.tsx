import { motion } from 'motion/react';
import { spring } from '../../styles/motion';

const LETTERS = ['W', 'O', 'R', 'D', 'L', 'Y'];
const TONES = ['correct', 'present', 'absent', 'correct', 'present', 'correct'] as const;

/** Tile wordmark. When `animate` is set, the tiles flip in one after another. */
export function Logo({ size = 40, animate = false }: { size?: number; animate?: boolean }) {
  return (
    <div dir="ltr" style={{ display: 'flex', gap: size * 0.12, perspective: 600 }} aria-label="WORDLY" role="img">
      {LETTERS.map((l, i) => (
        <motion.span
          key={l}
          aria-hidden
          initial={animate ? { rotateX: -90, opacity: 0, y: -8 } : false}
          animate={{ rotateX: 0, opacity: 1, y: 0 }}
          transition={{ ...spring.bouncy, delay: animate ? 0.12 + i * 0.09 : 0 }}
          style={{
            width: size,
            height: size,
            borderRadius: size * 0.2,
            display: 'grid',
            placeItems: 'center',
            fontWeight: 800,
            fontSize: size * 0.52,
            color: '#fff',
            background: `var(--${TONES[i]})`,
            boxShadow: 'inset 0 -3px 0 rgba(0,0,0,.12)',
          }}
        >
          {l}
        </motion.span>
      ))}
    </div>
  );
}
