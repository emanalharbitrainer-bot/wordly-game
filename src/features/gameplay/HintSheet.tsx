import { motion } from 'motion/react';
import { useApp } from '../../app/store';
import { Sheet } from '../../components/modals/Sheet';
import { getRules } from '../../core/difficulty/difficulty-config';
import { getHintOptions } from '../../core/hints/hint-engine';
import { getLanguageEngine } from '../../core/localization/localization-engine';
import { formatNumber, type StringKey } from '../../core/localization/ui-strings';
import { itemVariants, listVariants } from '../../styles/motion';

export function HintSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useApp((s) => s.session);
  const coins = useApp((s) => s.coins);
  const t = useApp((s) => s.t);
  const lang = useApp((s) => s.prefs.uiLang);
  const useHint = useApp((s) => s.useHint);
  if (!session) return null;
  const rules = getRules(session.difficulty, session.mode);
  const options = getHintOptions(session, rules, coins);
  const le = getLanguageEngine(session.lang);

  return (
    <Sheet open={open} onClose={onClose} label={t('hint.title')}>
      <h2 className="sheet__title">{t('hint.title')}</h2>
      <p className="sheet__subtitle">
        {t('hint.used', { used: session.hints.length, max: rules.maxHints })} ·{' '}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span className="coin" /> {formatNumber(coins, lang)}
        </span>
      </p>
      <motion.div className="stack" variants={listVariants} initial="hidden" animate="show">
        {options.map((o) => {
          const used = session.hints.find((h) => h.type === o.type && h.text);
          return (
            <motion.button
              key={o.type}
              variants={itemVariants}
              whileTap={o.available ? { scale: 0.98 } : undefined}
              className="choice"
              disabled={!o.available}
              style={{ opacity: o.available || used ? 1 : 0.55 }}
              onClick={() => {
                useHint(o.type);
                if (o.type === 'letter' || o.type === 'position') onClose();
              }}
            >
              <span className="choice__body">
                <span className="choice__title">{t(`hint.${o.type}` as StringKey)}</span>
                <span className="choice__desc" style={{ display: 'block' }}>
                  {used ? used.text : o.reason ? t(`hint.block.${o.reason}` as StringKey) : ''}
                </span>
              </span>
              {!used && (
                <span className="choice__meta" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  <span className="coin" /> {formatNumber(o.cost, lang)}
                </span>
              )}
            </motion.button>
          );
        })}
        {session.hints
          .filter((h) => h.letter)
          .map((h, i) => (
            <div key={i} className="hint-chip center">
              {t('hint.letterReveal', { letter: le.display(h.letter!), pos: (h.position ?? 0) + 1 })}
            </div>
          ))}
      </motion.div>
    </Sheet>
  );
}
