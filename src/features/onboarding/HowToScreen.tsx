import { motion } from 'motion/react';
import { useApp } from '../../app/store';
import { Button } from '../../components/buttons/Button';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { getLanguageEngine } from '../../core/localization/localization-engine';
import type { StringKey } from '../../core/localization/ui-strings';
import { itemVariants, listVariants } from '../../styles/motion';
import type { LetterResult } from '../../types';

const EXAMPLES: Record<'ar' | 'en', { word: string; i: number; r: LetterResult }[]> = {
  en: [
    { word: 'crane', i: 0, r: 'correct' },
    { word: 'pilot', i: 1, r: 'present' },
    { word: 'vague', i: 3, r: 'absent' },
  ],
  ar: [
    { word: 'مدرسة', i: 0, r: 'correct' },
    { word: 'سحابة', i: 1, r: 'present' },
    { word: 'طاولة', i: 3, r: 'absent' },
  ],
};

export default function HowToScreen() {
  const { t, prefs, setPrefs, back } = useApp();
  const lang = prefs.puzzleLang;
  const le = getLanguageEngine(lang);
  return (
    <>
      <ScreenHeader title={t('howto.title')} />
      <motion.div className="stack" variants={listVariants} initial="hidden" animate="show" style={{ lineHeight: 1.7 }}>
        <motion.p variants={itemVariants} style={{ margin: 0 }}>
          {t('howto.intro')}
        </motion.p>
        <motion.p variants={itemVariants} style={{ margin: 0, fontWeight: 600 }}>
          {t('howto.colors')}
        </motion.p>
        {EXAMPLES[lang].map((ex, k) => (
          <motion.div key={ex.word} variants={itemVariants} className="card">
            <div style={{ display: 'flex', gap: 5, ['--tile' as string]: '42px', marginBottom: 8 }} dir={le.dir}>
              {le.toLetters(ex.word).map((l, i) => (
                <div
                  key={i}
                  className={`tile ${i === ex.i ? `tile--${ex.r} tile--revealing` : 'tile--filled'}`}
                  style={{ ['--i' as string]: k * 2 + 2 }}
                >
                  {le.display(l)}
                  <span className="tile__mark" aria-hidden />
                </div>
              ))}
            </div>
            <div style={{ fontSize: 14 }}>
              <b>{le.display(le.toLetters(ex.word)[ex.i])}</b> — {t(`howto.${ex.r}` as StringKey)}
            </div>
          </motion.div>
        ))}
        <motion.p variants={itemVariants} style={{ margin: 0 }}>
          {t('howto.keyboard')}
        </motion.p>
        <motion.p variants={itemVariants} style={{ margin: 0 }} className="muted">
          {t('howto.modes')}
        </motion.p>
        <motion.div variants={itemVariants}>
          <Button
            variant="primary"
            block
            onClick={() => {
              setPrefs({ seenHowTo: true });
              back();
            }}
          >
            {t('howto.ok')}
          </Button>
        </motion.div>
      </motion.div>
    </>
  );
}
