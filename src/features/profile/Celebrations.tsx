import { burst } from '../../components/animations/confetti';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';
import { useApp } from '../../app/store';
import { flameColors } from '../../core/progress/progress-engine';
import { spring } from '../../styles/motion';
import { haptic } from '../assistant/assistant-store';
import { daysText, num, sfmt, sx } from '../social/i18n';
import { Flame } from './Flame';
import { useProfile } from './profile-store';
import { sfx } from './sfx';

/**
 * Full-screen moments for level-ups, streak milestones and shields. They wait until no result
 * sheet / reveal is on screen so they never fight the round's own animation.
 */
export function Celebrations() {
  const c = useProfile((s) => s.celebrations[0]);
  const pop = useProfile((s) => s.popCelebration);
  const showResult = useApp((s) => s.showResult);
  const revealing = useApp((s) => s.revealingRow);
  const lang = useApp((s) => s.prefs.uiLang);
  const s = sx(lang);
  // show after the player closes the result sheet (or right away elsewhere)
  const ready = !!c && !showResult && revealing === null;

  useEffect(() => {
    if (!ready || !c) return;
    haptic([15, 40, 15, 40, 60]);
    if (c.kind === 'level') sfx.level();
    else sfx.whoosh(4);
    const colors = c.kind === 'streak' ? Object.values(flameColors(c.difficulty)).slice(0, 3) : ['#2f9e6e', '#d9a62e', '#ffffff'];
    if (document.documentElement.dataset.motion !== 'reduced') {
      const end = Date.now() + 900;
      const frame = () => {
        burst({ particleCount: 6, angle: 60, spread: 70, origin: { x: 0, y: 0.75 }, colors, zIndex: 9999 });
        burst({ particleCount: 6, angle: 120, spread: 70, origin: { x: 1, y: 0.75 }, colors, zIndex: 9999 });
        if (Date.now() < end) requestAnimationFrame(frame);
      };
      frame();
    }
    const id = setTimeout(pop, 5200);
    return () => clearTimeout(id);
  }, [ready, c, pop]);

  return (
    <AnimatePresence>
      {ready && c && (
        <motion.div key={c.id} className="celeb" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }} onClick={pop} role="dialog" aria-live="assertive">
          <motion.div className="celeb__rays" initial={{ scale: 0.2, rotate: -40, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
          <motion.div className="celeb__card" initial={{ scale: 0.5, y: 40, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} transition={{ ...spring.bouncy, delay: 0.1 }}>
            {c.kind === 'level' && (
              <>
                <div className="celeb__eyebrow">{s.levelUp}</div>
                <motion.div className="celeb__level" initial={{ scale: 3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 14, delay: 0.25 }}>
                  {num(c.level, lang)}
                </motion.div>
                <motion.div className="celeb__title" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
                  {s.newTitle}: <b>{c.title[lang]}</b>
                </motion.div>
              </>
            )}
            {c.kind === 'streak' && (
              <>
                <Flame count={c.n} difficulty={c.difficulty} size={130} interactive={false} showCount={false} />
                <div className="celeb__level" style={{ fontSize: 44 }}>
                  {sfmt(s.milestone, { n: daysText(c.n, lang) })}
                </div>
                <div className="celeb__title">{s.milestoneSub}</div>
              </>
            )}
            {c.kind === 'shield' && (
              <>
                <motion.div style={{ fontSize: 84 }} initial={{ rotateY: 180, scale: 0.3 }} animate={{ rotateY: 0, scale: 1 }} transition={{ ...spring.bouncy, delay: 0.2 }}>
                  🛡️
                </motion.div>
                <div className="celeb__level" style={{ fontSize: 30 }}>
                  {s.shieldEarned}
                </div>
                <div className="celeb__title">{s.shieldSub}</div>
              </>
            )}
            <button className="btn btn--primary" style={{ marginTop: 16 }} onClick={pop}>
              {s.awesome}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
