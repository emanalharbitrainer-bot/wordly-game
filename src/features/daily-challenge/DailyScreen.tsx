import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/store';
import { CountUp } from '../../components/animations/CountUp';
import { Skeleton } from '../../components/animations/Skeleton';
import { Button } from '../../components/buttons/Button';
import { Icon } from '../../components/layout/Icon';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { decodePattern } from '../../services/daily/daily-client';
import { formatNumber, type StringKey } from '../../core/localization/ui-strings';
import { dailyStreak } from '../../core/statistics/statistics-engine';
import { itemVariants, listVariants, spring } from '../../styles/motion';
import type { Lang } from '../../types';
import { v3 } from '../v3/strings';

function msToRiyadhMidnight(): number {
  const now = new Date();
  const riyadh = new Date(now.getTime() + 3 * 3600_000); // Asia/Riyadh is UTC+3 all year
  const next = Date.UTC(riyadh.getUTCFullYear(), riyadh.getUTCMonth(), riyadh.getUTCDate() + 1) - 3 * 3600_000;
  return next - now.getTime();
}

function Countdown({ lang }: { lang: Lang }) {
  const [ms, setMs] = useState(msToRiyadhMidnight());
  useEffect(() => {
    const id = setInterval(() => setMs(msToRiyadhMidnight()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => formatNumber(n, lang).padStart(2, lang === 'ar' ? '٠' : '0');
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 28, letterSpacing: '0.04em' }} dir="ltr">
      {pad(Math.floor(s / 3600))}:{pad(Math.floor((s % 3600) / 60))}:{pad(s % 60)}
    </span>
  );
}

const COLOR = { correct: 'var(--correct)', present: 'var(--present)', absent: 'var(--absent)' } as const;

export default function DailyScreen() {
  const { t, daily, loadDaily, startDaily, results, prefs, dictLoading, setDailyHard, go } = useApp();
  const x = v3(prefs.uiLang);
  const [hardBusy, setHardBusy] = useState(false);
  const [lang, setLang] = useState<Lang>(daily.lang ?? prefs.puzzleLang);

  useEffect(() => {
    void loadDaily(lang);
  }, [lang, loadDaily]);

  const st = daily.lang === lang ? daily.state : undefined;
  const streak = st ? dailyStreak(results, lang, st.date) : { current: 0, best: 0 };
  const finished = st && st.status !== 'PLAYING';

  return (
    <>
      <ScreenHeader title={t('daily.title')} subtitle={t('daily.subtitle')} />

      <div className="pill" role="tablist" style={{ alignSelf: 'center', padding: 3, gap: 0, marginBottom: 16 }}>
        {(['ar', 'en'] as const).map((l) => (
          <button key={l} role="tab" aria-selected={lang === l} onClick={() => setLang(l)} style={{ position: 'relative', padding: '7px 18px', borderRadius: 999, fontWeight: 700, color: lang === l ? 'var(--accent-ink)' : 'var(--ink-2)' }}>
            {lang === l && <motion.span layoutId="daily-tab" transition={spring.snappy} style={{ position: 'absolute', inset: 0, borderRadius: 999, background: 'var(--accent)' }} />}
            <span style={{ position: 'relative' }}>{t(`lang.${l}` as StringKey)}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {daily.status === 'error' && daily.lang === lang ? (
          <motion.div key="err" className="card stack center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <p style={{ margin: 0 }}>{t('daily.offline')}</p>
            <Button onClick={() => void loadDaily(lang)}>
              <Icon name="refresh" /> {t('daily.retry')}
            </Button>
          </motion.div>
        ) : !st ? (
          <motion.div key="sk" className="stack" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-busy="true">
            <Skeleton h={150} r={18} />
            <Skeleton h={90} r={18} />
            <Skeleton h={54} r={18} />
          </motion.div>
        ) : (
          <motion.div key={`${lang}-${st.date}`} className="stack" variants={listVariants} initial="hidden" animate="show" exit={{ opacity: 0 }}>
            <motion.div variants={itemVariants} className="card center" style={{ padding: 22 }}>
              <div className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
                {t('daily.number', { n: st.number })}
              </div>
              <div style={{ display: 'grid', gap: 5, justifyContent: 'center', margin: '14px 0' }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                {Array.from({ length: st.max_attempts }, (_, r) => (
                  <div key={r} style={{ display: 'flex', gap: 5 }}>
                    {Array.from({ length: st.length }, (_, c) => {
                      const p = st.patterns[r];
                      const res = p ? decodePattern(p)[c] : null;
                      return (
                        <motion.span
                          key={c}
                          initial={{ scale: 0.4, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ ...spring.bouncy, delay: 0.1 + r * 0.05 + c * 0.03 }}
                          style={{ width: 18, height: 18, borderRadius: 4, background: res ? COLOR[res] : 'transparent', boxShadow: res ? 'none' : 'inset 0 0 0 1.5px var(--tile-border)' }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {t('daily.rules')}
              </div>
            </motion.div>

            <motion.div variants={itemVariants} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="card center">
                <div style={{ fontSize: 28, fontWeight: 800, display: 'inline-flex', gap: 6, alignItems: 'center', color: streak.current ? 'var(--danger)' : undefined }}>
                  <Icon name="flame" /> <CountUp value={streak.current} lang={prefs.uiLang} />
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {t('daily.streak')}
                </div>
              </div>
              <div className="card center">
                <div style={{ fontSize: 28, fontWeight: 800 }}>
                  <CountUp value={streak.best} lang={prefs.uiLang} />
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {t('daily.best')}
                </div>
              </div>
            </motion.div>

            {finished ? (
              <motion.div variants={itemVariants} className="card center stack">
                <div style={{ fontWeight: 700 }}>{t('daily.done')}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {t('daily.next')}
                </div>
                <Countdown lang={prefs.uiLang} />
                <Button onClick={() => void startDaily()}>{t('learn.title')}</Button>
              </motion.div>
            ) : (
              <>
              <motion.div variants={itemVariants} className="card hard-row">
                <div className="grow">
                  <div style={{ fontWeight: 700 }}>
                    {x.hard} <span className="hard-badge">×1.5</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {st.guesses.length ? x.hardLocked : x.hardDesc}
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={!!st.hard}
                  aria-label={x.hard}
                  disabled={hardBusy || st.guesses.length > 0}
                  className={`switch${st.hard ? ' is-on' : ''}`}
                  onClick={async () => {
                    setHardBusy(true);
                    await setDailyHard(!st.hard);
                    setHardBusy(false);
                  }}
                >
                  <i />
                </button>
              </motion.div>
              <motion.div variants={itemVariants}>
                <Button variant="primary" block style={{ minHeight: 58 }} disabled={dictLoading} onClick={() => void startDaily()}>
                  {st.guesses.length ? t('daily.continue') : t('daily.start')}
                  {st.guesses.length > 0 && <span style={{ opacity: 0.75 }}>· {formatNumber(st.guesses.length, prefs.uiLang)}/{formatNumber(st.max_attempts, prefs.uiLang)}</span>}
                </Button>
              </motion.div>
              </>
            )}
            <motion.div variants={itemVariants} style={{ display: 'flex', gap: 10 }}>
              <Button block onClick={() => go('archive')}>
                🗂️ {x.archive}
              </Button>
              <Button block onClick={() => go('league')}>
                🏆 {x.league}
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
