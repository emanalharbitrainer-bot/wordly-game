import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { getPlayerId, useApp } from '../../app/store';
import { Skeleton } from '../../components/animations/Skeleton';
import { Button } from '../../components/buttons/Button';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import type { StringKey } from '../../core/localization/ui-strings';
import { archiveList, type ArchiveDay } from '../../services/v3/v3-client';
import { itemVariants, listVariants, spring } from '../../styles/motion';
import type { Lang } from '../../types';
import { nfmt, v3 } from '../v3/strings';

const DATE_FMT: Partial<Record<Lang, Intl.DateTimeFormat>> = {};
function dayLabel(date: string, lang: Lang) {
  DATE_FMT[lang] ??= new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return DATE_FMT[lang]!.format(new Date(`${date}T00:00:00Z`));
}

/** Every past daily challenge, playable once (server-evaluated, like the daily). */
export default function ArchiveScreen() {
  const { t, prefs, startArchive, dictLoading } = useApp();
  const ui = prefs.uiLang;
  const x = v3(ui);
  const [lang, setLang] = useState<Lang>(prefs.puzzleLang);
  const [days, setDays] = useState<ArchiveDay[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    setDays(null);
    setError(false);
    archiveList(getPlayerId(), lang, ac.signal).then(setDays, () => !ac.signal.aborted && setError(true));
    return () => ac.abort();
  }, [lang]);

  return (
    <>
      <ScreenHeader title={x.archive} subtitle={x.archiveDesc} />
      <div className="pill" role="tablist" style={{ alignSelf: 'center', padding: 3, gap: 0, marginBottom: 10 }}>
        {(['ar', 'en'] as const).map((l) => (
          <button key={l} role="tab" aria-selected={lang === l} onClick={() => setLang(l)} style={{ position: 'relative', padding: '7px 18px', borderRadius: 999, fontWeight: 700, color: lang === l ? 'var(--accent-ink)' : 'var(--ink-2)' }}>
            {lang === l && <motion.span layoutId="archive-tab" transition={spring.snappy} style={{ position: 'absolute', inset: 0, borderRadius: 999, background: 'var(--accent)' }} />}
            <span style={{ position: 'relative' }}>{t(`lang.${l}` as StringKey)}</span>
          </button>
        ))}
      </div>
      <p className="muted center" style={{ margin: '0 0 12px', fontSize: 12 }}>
        {x.archiveNote}
      </p>
      {error ? (
        <div className="card center">{x.err_offline}</div>
      ) : !days ? (
        <div className="stack" aria-busy="true">
          <Skeleton h={64} r={16} />
          <Skeleton h={64} r={16} />
          <Skeleton h={64} r={16} />
        </div>
      ) : days.length === 0 ? (
        <div className="card center muted">{x.archiveEmpty}</div>
      ) : (
        <motion.ul className="archive" variants={listVariants} initial="hidden" animate="show">
          {days.map((d) => {
            const done = d.status === 'WON' || d.status === 'LOST';
            const st = d.status === 'WON' ? nfmt(x.stWON, { n: d.attempts }, ui) : x[`st${d.status}`];
            return (
              <motion.li key={d.date} variants={itemVariants} className={`archive__day is-${d.status.toLowerCase()}`}>
                <span className="archive__num">#{nfmt('{n}', { n: d.number }, ui)}</span>
                <span className="grow">
                  <span className="archive__date">{dayLabel(d.date, ui)}</span>
                  <span className="archive__st">
                    {st}
                    {d.hard && ` · ${x.hardBadge}`}
                  </span>
                </span>
                <Button variant={done ? 'default' : 'primary'} disabled={dictLoading} onClick={() => void startArchive(lang, d.date)}>
                  {done ? t('learn.title') : x.play}
                </Button>
              </motion.li>
            );
          })}
        </motion.ul>
      )}
    </>
  );
}
