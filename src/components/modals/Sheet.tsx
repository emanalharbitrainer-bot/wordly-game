import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { spring } from '../../styles/motion';

/** Bottom sheet with a fading scrim; slides up on a damped spring. Escape / scrim tap closes. */
export function Sheet({ open, onClose, children, label, dismissible = true }: { open: boolean; onClose?: () => void; children: ReactNode; label: string; dismissible?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // Drag is switched on once the sheet has landed: enabling it at mount forces a synchronous
  // layout measurement in the middle of the slide-in.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!open) setSettled(false);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, dismissible]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            className="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={dismissible ? onClose : undefined}
          />
          <motion.div
            key="sheet"
            ref={ref}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className="sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%', transition: { duration: 0.22, ease: [0.65, 0, 0.35, 1] } }}
            transition={spring.sheet}
            onAnimationComplete={() => {
              if (!open) return;
              setSettled(true);
              // focus after the slide-in: focusing at mount forced layout mid-animation
              ref.current?.focus({ preventScroll: true });
            }}
            drag={dismissible && settled ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (dismissible && (info.offset.y > 120 || info.velocity.y > 600)) onClose?.();
            }}
          >
            <div className="sheet__grip" />
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
