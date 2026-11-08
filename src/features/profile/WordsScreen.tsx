import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { useApp } from '../../app/store';
import { Button } from '../../components/buttons/Button';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { getLanguageEngine } from '../../core/localization/localization-engine';
import { wordList, type LearnedWord } from '../../core/progress/progress-engine';
import { spring } from '../../styles/motion';
import { haptic, useAssistant } from '../assistant/assistant-store';
import { num, sfmt, sx } from '../social/i18n';
import { useProfile } from './profile-store';

type Filter = 'all' | 'ar' | 'en' | 'won' | 'missed' | 'fav';

/** The learned-words log: searchable, filterable flip cards with meaning, pronunciation and example. */
export default function WordsScreen() {
  const lang = useApp((s) => s.prefs.uiLang);
  const go = useApp((s) => s.go);
  const progress = useProfile((s) => s.progress);
  const toggleFav = useProfile((s) => s.toggleFav);
  const s = sx(lang);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const all = useMemo(() => wordList(progress), [progress]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((w) => {
      if (filter === 'ar' || filter === 'en') {
        if (w.lang !== filter) return false;
      } else if (filter === 'won' && !w.won) return false;
      else if (filter === 'missed' && w.won) return false;
      else if (filter === 'fav' && !w.fav) return false;
      if (!needle) return true;
      return [w.w, w.d, w.m, w.t ?? '', w.c ?? ''].some((x) => x.toLowerCase().includes(needle));
    });
  }, [all, q, filter]);

  const filters: [Filter, string][] = [
    ['all', s.all],
    ['ar', 'عربي'],
    ['en', 'English'],
    ['won', `✓ ${s.solved}`],
    ['missed', `✗ ${s.missed}`],
    ['fav', `★ ${s.fav}`],
  ];

  return (
    <>
      <ScreenHeader title={s.wordsTitle} subtitle={sfmt(s.wordsSub, { n: num(all.length, lang) })} />
      <div className="words">
        <div className="words__bar">
          <input className="input words__search" value={q} dir="auto" placeholder={`🔎 ${s.search}`} onChange={(e) => setQ(e.target.value)} />
          <div className="words__filters">
            {filters.map(([k, label]) => (
              <button key={k} className={`chip${filter === k ? ' is-on' : ''}`} onClick={() => (haptic(4), setFilter(k))}>
                {filter === k && <motion.span layoutId="words-chip" className="chip__bg" transition={spring.snappy} />}
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {all.length > 0 && (
          <div className="words__ai">
            <Button block className="btn--ai" onClick={() => useAssistant.getState().openPanel(s.reviewPrompt, { display: `🧠 ${s.review.replace(' ✨', '')}` })}>
              {s.review}
            </Button>
            <Button className="btn--ai" onClick={() => useAssistant.getState().openPanel(s.coachPrompt, { display: `🎯 ${s.coach}` })}>
              🎯
            </Button>
          </div>
        )}

        {all.length === 0 ? (
          <motion.div className="words__empty card" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={spring.soft}>
            <div className="words__empty-tiles" aria-hidden>
              {['ك', 'ل', 'م', 'ة'].map((l, i) => (
                <motion.span key={i} className="tile tile--correct tile--settled" style={{ ['--i' as string]: i }} animate={{ y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 1.6, delay: i * 0.15 }}>
                  {l}
                </motion.span>
              ))}
            </div>
            <p>{s.emptyWords}</p>
            <Button variant="primary" onClick={() => go('language', { intent: 'classic' })}>
              {lang === 'ar' ? 'العب الآن' : 'Play now'}
            </Button>
          </motion.div>
        ) : (
          <motion.div className="words__grid" layout>
            <AnimatePresence mode="popLayout">
              {list.map((w, i) => (
                <WordCard key={w.key} w={w} i={i} onFav={() => (haptic(8), toggleFav(w.key))} />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </>
  );
}

function WordCard({ w, i, onFav }: { w: LearnedWord & { key: string }; i: number; onFav(): void }) {
  const lang = useApp((s) => s.prefs.uiLang);
  const s = sx(lang);
  const [flip, setFlip] = useState(false);
  const le = getLanguageEngine(w.lang);
  const letters = le.toLetters(w.w);
  return (
    <motion.div
      layout
      className={`wcard${flip ? ' is-flipped' : ''}`}
      initial={{ opacity: 0, y: 20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ ...spring.soft, delay: Math.min(i, 12) * 0.03 }}
    >
      <motion.div
        className="wcard__inner"
        animate={{ rotateY: flip ? 180 : 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        onClick={() => (haptic(5), setFlip((f) => !f))}
        role="button"
        tabIndex={0}
        aria-label={`${w.d} — ${s.tapFlip}`}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setFlip((f) => !f)}
      >
        <div className="wcard__face wcard__front">
          <div className="wcard__tiles" dir={le.dir}>
            {letters.map((l, j) => (
              <span key={j} className={`wtile${w.won ? ' is-won' : ' is-missed'}`} style={{ ['--j' as string]: j }}>
                {le.display(l)}
              </span>
            ))}
          </div>
          {w.d !== w.w && (
            <div className="wcard__display" lang={w.lang}>
              {w.d}
            </div>
          )}
          <div className="wcard__meta">
            <span className={`badge ${w.won ? 'badge--won' : 'badge--missed'}`}>{w.won ? `✓ ${s.solved}` : `✗ ${s.missed}`}</span>
            {w.mode === 'duel' && <span className="badge">⚔️</span>}
            {w.count > 1 && <span className="badge">{sfmt(s.seenTimes, { n: w.count })}</span>}
          </div>
          <div className="wcard__peek" lang={w.lang} dir={le.dir}>
            {w.m}
          </div>
        </div>
        <div className="wcard__face wcard__back" dir={le.dir}>
          {w.c && <div className="wcard__cat">{w.c}</div>}
          <div className="wcard__mean" lang={w.lang}>
            {w.m}
          </div>
          {w.t && (
            <div className="wcard__tr" lang="ar" dir="rtl">
              🇸🇦 {w.t}
            </div>
          )}
          {w.p && (
            <div className="wcard__pron" lang={w.lang}>
              🔊 {w.p}
            </div>
          )}
          {w.e && (
            <div className="wcard__ex" lang={w.lang}>
              “{w.e}”
            </div>
          )}
        </div>
      </motion.div>
      <motion.button className={`wcard__fav${w.fav ? ' is-on' : ''}`} whileTap={{ scale: 0.6, rotate: -30 }} onClick={onFav} aria-label={s.fav}>
        {w.fav ? '★' : '☆'}
      </motion.button>
    </motion.div>
  );
}
