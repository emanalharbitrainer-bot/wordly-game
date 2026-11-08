import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { useApp } from '../../app/store';
import { CountUp } from '../../components/animations/CountUp';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { DIFFICULTIES } from '../../core/difficulty/difficulty-config';
import { formatNumber, type StringKey } from '../../core/localization/ui-strings';
import { computeStats, type StatsFilter } from '../../core/statistics/statistics-engine';
import { EASE_OUT, itemVariants, listVariants, spring } from '../../styles/motion';
import type { Lang } from '../../types';

type Scope = 'all' | Lang;

function Bar({ label, value, max, highlight, lang, delay }: { label: string; value: number; max: number; highlight?: boolean; lang: Lang; delay: number }) {
  const pct = max ? Math.max(8, (value / max) * 100) : 8;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 18, fontWeight: 700, fontSize: 13, textAlign: 'center' }}>{label}</span>
      <div style={{ flex: 1 }}>
        <motion.div
          initial={{ width: '8%' }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: EASE_OUT, delay }}
          style={{ background: highlight ? 'var(--correct)' : 'var(--absent)', color: '#fff', borderRadius: 6, padding: '3px 8px', fontSize: 12, fontWeight: 700, textAlign: 'end', minWidth: 26 }}
        >
          {formatNumber(value, lang)}
        </motion.div>
      </div>
    </div>
  );
}

export default function StatsScreen() {
  const { t, results, prefs } = useApp();
  const [scope, setScope] = useState<Scope>('all');
  const lang = prefs.uiLang;
  const filter: StatsFilter = scope === 'all' ? {} : { lang: scope };
  const stats = useMemo(() => computeStats(results, filter), [results, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxDist = Math.max(0, ...Object.values(stats.distribution));
  const infiniteBest = useMemo(() => computeStats(results, { ...filter, mode: 'infinite' }).longestStreak, [results, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const tiles: { key: StringKey; value: number; suffix?: string; decimals?: number }[] = [
    { key: 'stats.played', value: stats.played },
    { key: 'stats.winRate', value: stats.winRate, suffix: '%' },
    { key: 'stats.current', value: stats.currentStreak },
    { key: 'stats.best', value: stats.longestStreak },
    { key: 'stats.avg', value: stats.averageAttempts, decimals: 1 },
    { key: 'stats.daily', value: stats.dailyCompleted },
  ];

  return (
    <>
      <ScreenHeader title={t('stats.title')} />
      <div className="pill" role="tablist" style={{ alignSelf: 'center', padding: 3, gap: 0, marginBottom: 14 }}>
        {(['all', 'ar', 'en'] as const).map((s) => (
          <button key={s} role="tab" aria-selected={scope === s} onClick={() => setScope(s)} style={{ position: 'relative', padding: '6px 16px', borderRadius: 999, fontWeight: 700, color: scope === s ? 'var(--accent-ink)' : 'var(--ink-2)' }}>
            {scope === s && <motion.span layoutId="stats-tab" transition={spring.snappy} style={{ position: 'absolute', inset: 0, borderRadius: 999, background: 'var(--accent)' }} />}
            <span style={{ position: 'relative' }}>{s === 'all' ? t('stats.all') : t(`lang.${s}` as StringKey)}</span>
          </button>
        ))}
      </div>

      {stats.played === 0 ? (
        <motion.p className="center muted" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginTop: 40 }}>
          {t('stats.empty')}
        </motion.p>
      ) : (
        <motion.div key={scope} className="stack" variants={listVariants} initial="hidden" animate="show">
          <motion.div variants={itemVariants} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {tiles.map((x) => (
              <div key={x.key} className="card center" style={{ padding: '14px 6px' }}>
                <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>
                  <CountUp value={x.value} lang={lang} suffix={x.suffix} decimals={x.decimals} />
                </div>
                <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
                  {t(x.key)}
                </div>
              </div>
            ))}
          </motion.div>

          <motion.div variants={itemVariants} className="card stack" style={{ gap: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('stats.distribution')}</div>
            {[1, 2, 3, 4, 5, 6].map((n, i) => (
              <Bar key={n} label={formatNumber(n, lang)} value={stats.distribution[n] ?? 0} max={maxDist} lang={lang} delay={0.2 + i * 0.06} highlight={(stats.distribution[n] ?? 0) === maxDist && maxDist > 0} />
            ))}
          </motion.div>

          <motion.div variants={itemVariants} className="card stack" style={{ gap: 10 }}>
            <div style={{ fontWeight: 700 }}>{t('stats.byDifficulty')}</div>
            {DIFFICULTIES.map((d, i) => {
              const s = computeStats(results, { ...filter, difficulty: d });
              return (
                <div key={d} style={{ display: 'grid', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ fontWeight: 600 }}>{t(`diff.${d}` as StringKey)}</span>
                    <span className="muted">
                      {formatNumber(s.wins, lang)}/{formatNumber(s.played, lang)} · {formatNumber(s.winRate, lang)}%
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 8, background: 'var(--surface-2)', overflow: 'hidden' }}>
                    <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: s.winRate / 100 }} transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.3 + i * 0.08 }} style={{ height: '100%', background: 'var(--accent)', transformOrigin: lang === 'ar' ? 'right' : 'left' }} />
                  </div>
                </div>
              );
            })}
          </motion.div>

          {scope === 'all' && (
            <motion.div variants={itemVariants} className="card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ gridColumn: '1 / -1', fontWeight: 700 }}>{t('stats.byLanguage')}</div>
              {(['ar', 'en'] as const).map((l) => {
                const s = computeStats(results, { lang: l });
                return (
                  <div key={l} className="center">
                    <div style={{ fontSize: 22, fontWeight: 800 }}>
                      <CountUp value={s.winRate} lang={lang} suffix="%" />
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {t(`lang.${l}` as StringKey)} · {formatNumber(s.played, lang)}
                    </div>
                  </div>
                );
              })}
            </motion.div>
          )}

          <motion.div variants={itemVariants} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600 }}>{t('stats.infiniteBest')}</span>
            <span style={{ fontWeight: 800, fontSize: 20 }}>
              <CountUp value={infiniteBest} lang={lang} />
            </span>
          </motion.div>
        </motion.div>
      )}
    </>
  );
}
