import { motion } from 'motion/react';
import { useApp } from '../../app/store';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { DIFFICULTIES, DIFFICULTY_CONFIG } from '../../core/difficulty/difficulty-config';
import type { StringKey } from '../../core/localization/ui-strings';
import { itemVariants, listVariants } from '../../styles/motion';
import type { Difficulty, Lang } from '../../types';

/** Language Selection screen (puzzle language). */
export function LanguageScreen() {
  const { t, prefs, setPrefs, go } = useApp();
  const pick = (l: Lang) => {
    setPrefs({ puzzleLang: l });
    go('difficulty');
  };
  return (
    <>
      <ScreenHeader title={t('lang.title')} subtitle={t('lang.subtitle')} />
      <motion.div className="stack" variants={listVariants} initial="hidden" animate="show">
        {(['ar', 'en'] as const).map((l) => (
          <motion.button
            key={l}
            variants={itemVariants}
            whileTap={{ scale: 0.98 }}
            className="choice"
            aria-pressed={prefs.puzzleLang === l}
            onClick={() => pick(l)}
            style={{ padding: 20 }}
          >
            <span className="choice__badge" style={{ background: l === 'ar' ? 'var(--correct)' : 'var(--present)', width: 60, height: 60, fontSize: 26 }}>
              {l === 'ar' ? 'ض' : 'Aa'}
            </span>
            <span className="choice__body">
              <span className="choice__title" style={{ fontSize: 18 }} lang={l}>
                {t(`lang.${l}` as StringKey)}
              </span>
              <span className="choice__desc" style={{ display: 'block' }}>
                {t(`lang.${l}.desc` as StringKey)}
              </span>
            </span>
          </motion.button>
        ))}
      </motion.div>
    </>
  );
}

const DIFF_COLORS: Record<Difficulty, string> = {
  easy: 'var(--correct)',
  normal: 'var(--accent)',
  hard: 'var(--present)',
  expert: 'var(--danger)',
};

/** Difficulty Selection screen — shared by Classic and Infinite. */
export function DifficultyScreen() {
  const { t, prefs, setPrefs, startGame, intent, dictLoading } = useApp();
  const pick = (d: Difficulty) => {
    if (dictLoading) return;
    setPrefs({ difficulty: d });
    void startGame(intent === 'infinite' ? 'infinite' : 'classic', { difficulty: d, lang: prefs.puzzleLang });
  };
  return (
    <>
      <ScreenHeader title={t('diff.title')} subtitle={`${t(intent === 'infinite' ? 'mode.infinite' : 'mode.classic')} · ${t(`lang.${prefs.puzzleLang}` as StringKey)}`} />
      <motion.div className="stack" variants={listVariants} initial="hidden" animate="show">
        {DIFFICULTIES.map((d, i) => (
          <motion.button key={d} variants={itemVariants} whileTap={{ scale: 0.98 }} className="choice" aria-pressed={prefs.difficulty === d} onClick={() => pick(d)}>
            <span className="choice__badge" style={{ background: DIFF_COLORS[d] }}>
              <span style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 20 }} aria-hidden>
                {[0, 1, 2, 3].map((b) => (
                  <span key={b} style={{ width: 4, height: 6 + b * 4, borderRadius: 2, background: '#fff', opacity: b <= i ? 1 : 0.35 }} />
                ))}
              </span>
            </span>
            <span className="choice__body">
              <span className="choice__title">{t(`diff.${d}` as StringKey)}</span>
              <span className="choice__desc" style={{ display: 'block' }}>
                {t(`diff.${d}.desc` as StringKey)}
              </span>
            </span>
            <span className="choice__meta">{t('diff.attempts', { n: DIFFICULTY_CONFIG[d].maxAttempts })}</span>
          </motion.button>
        ))}
      </motion.div>
    </>
  );
}
