import { motion } from 'motion/react';
import { useApp } from '../../app/store';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { ACHIEVEMENTS } from '../../core/achievements/achievement-engine';
import type { StringKey } from '../../core/localization/ui-strings';
import { EASE_OUT, itemVariants, listVariants, spring } from '../../styles/motion';

export default function AchievementsScreen() {
  const { t, achievements, prefs } = useApp();
  const unlocked = ACHIEVEMENTS.filter((a) => achievements[a.id]).length;
  const pct = unlocked / ACHIEVEMENTS.length;
  const fmt = new Intl.DateTimeFormat(prefs.uiLang === 'ar' ? 'ar-SA' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <>
      <ScreenHeader title={t('ach.title')} subtitle={t('ach.unlocked', { n: unlocked, total: ACHIEVEMENTS.length })} />
      <div style={{ height: 10, borderRadius: 10, background: 'var(--surface-2)', overflow: 'hidden', marginBottom: 16, boxShadow: 'inset 0 0 0 1px var(--line)' }}>
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: pct }}
          transition={{ duration: 1, ease: EASE_OUT, delay: 0.2 }}
          style={{ height: '100%', background: 'linear-gradient(90deg, var(--correct), var(--gold))', transformOrigin: prefs.uiLang === 'ar' ? 'right' : 'left' }}
        />
      </div>
      <motion.div variants={listVariants} initial="hidden" animate="show" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {ACHIEVEMENTS.map((a) => {
          const at = achievements[a.id];
          return (
            <motion.div key={a.id} variants={itemVariants} className="card" style={{ display: 'grid', gap: 8, opacity: at ? 1 : 0.55 }}>
              <motion.div
                initial={at ? { rotate: -20, scale: 0.6 } : false}
                animate={{ rotate: 0, scale: 1 }}
                transition={{ ...spring.bouncy, delay: 0.25 }}
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 14,
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 800,
                  fontSize: 18,
                  background: at ? 'linear-gradient(135deg, #f7d774, var(--gold))' : 'var(--surface-2)',
                  color: at ? '#4a3200' : 'var(--muted)',
                  boxShadow: at ? '0 8px 18px -8px var(--gold)' : 'inset 0 0 0 1px var(--line)',
                  filter: at ? 'none' : 'grayscale(1)',
                }}
              >
                {a.icon}
              </motion.div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{t(`ach.${a.id}.title` as StringKey)}</div>
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                {t(`ach.${a.id}.desc` as StringKey)}
              </div>
              {at && (
                <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>{fmt.format(new Date(at))}</div>
              )}
            </motion.div>
          );
        })}
      </motion.div>
    </>
  );
}
