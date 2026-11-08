import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { useApp } from '../../app/store';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import type { StringKey } from '../../core/localization/ui-strings';
import { isPackUnlocked, PACK_SIZE, visiblePacks } from '../../core/packs/packs';
import { levelInfo } from '../../core/progress/progress-engine';
import { activeSeason } from '../../core/season/season';
import { itemVariants, listVariants, spring } from '../../styles/motion';
import type { Lang } from '../../types';
import { useProfile } from '../profile/profile-store';
import { nfmt, v3 } from '../v3/strings';

/** Themed word packs: unlock with level, seasonal ones open for everyone during their season. */
export default function PacksScreen() {
  const { t, prefs, startPack, packProgress, dictLoading } = useApp();
  const ui = prefs.uiLang;
  const x = v3(ui);
  const [lang, setLang] = useState<Lang>(prefs.puzzleLang);
  const level = levelInfo(useProfile((s) => s.progress.xp)).level;
  const season = useMemo(() => activeSeason()?.id ?? null, []);
  const packs = visiblePacks(lang, season);

  return (
    <>
      <ScreenHeader title={x.packs} subtitle={x.packsDesc} />
      <div className="pill" role="tablist" style={{ alignSelf: 'center', padding: 3, gap: 0, marginBottom: 14 }}>
        {(['ar', 'en'] as const).map((l) => (
          <button key={l} role="tab" aria-selected={lang === l} onClick={() => setLang(l)} style={{ position: 'relative', padding: '7px 18px', borderRadius: 999, fontWeight: 700, color: lang === l ? 'var(--accent-ink)' : 'var(--ink-2)' }}>
            {lang === l && <motion.span layoutId="packs-tab" transition={spring.snappy} style={{ position: 'absolute', inset: 0, borderRadius: 999, background: 'var(--accent)' }} />}
            <span style={{ position: 'relative' }}>{t(`lang.${l}` as StringKey)}</span>
          </button>
        ))}
      </div>
      <motion.div className="packs" variants={listVariants} initial="hidden" animate="show">
        {packs.map((p) => {
          const open = isPackUnlocked(p, level, season);
          const solved = packProgress[p.id]?.length ?? 0;
          return (
            <motion.button
              key={p.id}
              variants={itemVariants}
              whileTap={open ? { scale: 0.96 } : undefined}
              className={`pack${open ? '' : ' is-locked'}${p.seasonal ? ' is-seasonal' : ''}`}
              disabled={!open || dictLoading}
              onClick={() => void startPack(p.id)}
              aria-label={ui === 'ar' ? p.ar : p.en}
            >
              {p.seasonal && <span className="pack__tag">{x.seasonal}</span>}
              <span className="pack__icon" aria-hidden>
                {open ? p.icon : '🔒'}
              </span>
              <span className="pack__name">{ui === 'ar' ? p.ar : p.en}</span>
              {open ? (
                <>
                  <span className="pack__bar">
                    <i style={{ transform: `scaleX(${solved / PACK_SIZE})` }} />
                  </span>
                  <span className="pack__meta">{solved >= PACK_SIZE ? '🏆' : nfmt(x.progress, { n: solved, m: PACK_SIZE }, ui)}</span>
                </>
              ) : (
                <span className="pack__meta">{nfmt(x.unlockAt, { n: p.level }, ui)}</span>
              )}
            </motion.button>
          );
        })}
      </motion.div>
    </>
  );
}
