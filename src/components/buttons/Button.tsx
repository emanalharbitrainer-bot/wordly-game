import { motion, type HTMLMotionProps } from 'motion/react';
import { spring } from '../../styles/motion';

type Variant = 'primary' | 'default' | 'ghost';

interface ButtonProps extends HTMLMotionProps<'button'> {
  variant?: Variant;
  block?: boolean;
}

/** Tactile button: squashes on press with a snappy spring, lifts slightly on hover. */
export function Button({ variant = 'default', block, className = '', ...rest }: ButtonProps) {
  const cls = ['btn', variant === 'primary' && 'btn--primary', variant === 'ghost' && 'btn--ghost', block && 'btn--block', className].filter(Boolean).join(' ');
  return <motion.button type="button" className={cls} whileTap={{ scale: 0.96 }} whileHover={{ y: -1 }} transition={spring.snappy} {...rest} />;
}

export function IconButton({ label, className = '', ...rest }: HTMLMotionProps<'button'> & { label: string }) {
  return <motion.button type="button" aria-label={label} title={label} className={`icon-btn ${className}`} whileTap={{ scale: 0.88 }} transition={spring.snappy} {...rest} />;
}
