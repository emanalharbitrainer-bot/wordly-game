import { motion } from 'motion/react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { getPlayerId } from '../../app/store';
import { percentile, type DayStats } from '../../core/league/league';
import { PACK_SIZE, packById } from '../../core/packs/packs';
import { computeStats } from '../../core/statistics/statistics-engine';
import { dayStats } from '../../services/v3/v3-client';
import { fmt, nfmt, num, v3 } from '../v3/strings';
import { useApp } from '../../app/store';
import { CountUp } from '../../components/animations/CountUp';
import { Button } from '../../components/buttons/Button';
import { Icon } from '../../components/layout/Icon';
import { Sheet } from '../../components/modals/Sheet';
import { ACHIEVEMENTS } from '../../core/achievements/achievement-engine';
import { getLanguageEngine } from '../../core/localization/localization-engine';
import type { StringKey } from '../../core/localization/ui-strings';
import { learnBlock, learnContainer, learnLetter, learnLetters, spring } from '../../styles/motion';
import type { AnswerEntry, Lang } from '../../types';
import { useAssistant } from '../assistant/assistant-store';
import { Flame } from '../profile/Flame';
import { XpBar } from '../profile/parts';
import type { RoundGain } from '../profile/profile-store';
import { daysText } from '../social/i18n';

/** Win / Lose screen with the animated learning card. */
export function ResultSheet() {
  const session = useApp((s) => s.session);
  const open = useApp((s) => s.showResult);
  const summary = useApp((s) => s.summary);
  const speed = useApp((s) => s.speed);
  const t = useApp((s) => s.t);
  const uiLang = useApp((s) => s.prefs.uiLang);
  const { closeResult, nextRound, quitGame, go } = useApp.getState();
  const [shareOpen, setShareOpen] = useState(false);
  if (!session) return null;

  const x = v3(uiLang);
  const won = session.rows.at(-1)?.results.every((r) => r === 'correct') ?? false;
  const answer = session.reveal;
  const isSpeed = session.mode === 'speed' && !!speed?.over;
  const isTutorial = session.mode === 'tutorial';
  const serverDay = session.mode === 'daily' || session.mode === 'archive';
  const packMeta = session.packId ? packById(session.packId) : undefined;
  const title = isSpeed ? x.speedOver : isTutorial ? x.tutorialDone : won ? t('win.title') : t('lose.title');

  return (
    <Sheet open={open} onClose={isTutorial ? () => useApp.getState().finishTutorial() : closeResult} label={title}>
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...spring.bouncy, delay: 0.1 }} className="center" style={{ fontSize: 44, lineHeight: 1 }} aria-hidden>
        {isSpeed ? '⚡' : won ? '🎉' : '🫶'}
      </motion.div>
      <h2 className="sheet__title" style={{ marginTop: 8 }}>
        {title}
        {session.hard && <span className="hard-badge">{x.hardBadge}</span>}
      </h2>
      {isSpeed ? (
        <SpeedSummary />
      ) : (
        <p className="sheet__subtitle">{won ? t('win.subtitle', { n: session.rows.length, max: session.maxAttempts }) : isTutorial ? fmt(x.coachLost, { w: answer?.d ?? '' }) : t('lose.subtitle')}</p>
      )}

      {!isTutorial && summary && summary.coins > 0 && (
        <motion.div className="center" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} style={{ marginBottom: 6 }}>
          <span className="pill" style={{ color: 'var(--ink)' }}>
            <span className="coin" /> +<CountUp value={summary.coins} lang={uiLang} />
          </span>
        </motion.div>
      )}
      {summary?.leaguePoints != null && summary.leaguePoints > 0 && (
        <motion.div className="center" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...spring.bouncy, delay: 0.45 }} style={{ marginBottom: 6 }}>
          <button className="pill league-pill" onClick={() => (closeResult(), go('league'))}>
            🏆 {nfmt(x.leaguePts, { n: summary.leaguePoints }, uiLang)}
          </button>
        </motion.div>
      )}
      {!isTutorial && summary?.gain && summary.gain.xp > 0 && <GainPanel gain={summary.gain} lang={uiLang} />}
      {summary?.newAchievements.map((id, i) => {
        const a = ACHIEVEMENTS.find((y) => y.id === id);
        return (
          <motion.div key={id} className="center" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...spring.bouncy, delay: 0.5 + i * 0.12 }} style={{ margin: '6px 0' }}>
            <span className="pill">
              <Icon name="trophy" /> {t(`ach.${id}.title` as StringKey)} {a?.icon}
            </span>
          </motion.div>
        );
      })}

      {open && serverDay && session.dailyDate && <DayStatsPanel lang={session.lang} date={session.dailyDate} won={won} attempts={session.rows.length} uiLang={uiLang} />}
      {open && !serverDay && !isSpeed && !isTutorial && <MyDistribution won={won} attempts={session.rows.length} uiLang={uiLang} />}
      {packMeta && <PackProgressLine packId={packMeta.id} uiLang={uiLang} />}

      {answer && !isSpeed && <LearningCard entry={answer} lang={session.lang} t={t} uiLang={uiLang} />}
      {isTutorial && <TutorialOutro />}

      <div className="stack" style={{ marginTop: 18 }}>
        {isTutorial ? (
          <Button variant="primary" block onClick={() => useApp.getState().finishTutorial()}>
            {x.goMenu}
          </Button>
        ) : isSpeed ? (
          <Button variant="primary" block onClick={nextRound}>
            ⚡ {x.speedAgain}
          </Button>
        ) : (
          <>
            {answer && (
              <Button
                block
                className="btn--ai"
                onClick={() => {
                  closeResult();
                  useAssistant.getState().openPanel();
                }}
              >
                ✨ {t('ai.askAboutWord')}
              </Button>
            )}
            {session.mode === 'custom' ? (
              <Button
                variant="primary"
                block
                onClick={() => {
                  closeResult();
                  useAssistant.getState().openPanel(uiLang === 'ar' ? 'أنشئ تحدياً جديداً مشابهاً' : 'Make a new similar challenge', { intent: 'build' });
                }}
              >
                ✨ {t('ai.newChallenge')}
              </Button>
            ) : session.mode === 'archive' ? (
              <Button variant="primary" block onClick={() => (closeResult(), quitGame(), go('archive'))}>
                <Icon name="calendar" /> {x.archive}
              </Button>
            ) : (
              session.mode !== 'daily' && (
                <Button variant="primary" block onClick={nextRound}>
                  <Icon name="refresh" /> {session.mode === 'infinite' || session.mode === 'pack' ? t('result.next') : t('result.again')}
                </Button>
              )
            )}
          </>
        )}
        {!isTutorial && (
          <div style={{ display: 'flex', gap: 10 }}>
            <Button block onClick={() => setShareOpen(true)}>
              <Icon name="share" /> {t('result.share')}
            </Button>
            <Button block variant={session.mode === 'daily' ? 'primary' : 'default'} onClick={quitGame}>
              {t('result.menu')}
            </Button>
          </div>
        )}
      </div>
      {shareOpen && (
        <Suspense fallback={null}>
          <ShareSheet open={shareOpen} onClose={() => setShareOpen(false)} />
        </Suspense>
      )}
    </Sheet>
  );
}

const ShareSheet = lazy(() => import('../share/ShareSheet'));

/** Everyone who finished this challenge: distribution + "better than X%". */
function DayStatsPanel({ lang, date, won, attempts, uiLang }: { lang: Lang; date: string; won: boolean; attempts: number; uiLang: Lang }) {
  const [stats, setStats] = useState<DayStats | null>(null);
  useEffect(() => {
    let alive = true;
    dayStats(getPlayerId(), lang, date).then((s) => alive && setStats(s), () => undefined);
    return () => {
      alive = false;
    };
  }, [lang, date]);
  if (!stats) return null;
  const x = v3(uiLang);
  const pct = percentile(stats, won, attempts);
  const bars = [1, 2, 3, 4, 5, 6].map((k) => ({ k: String(k), n: stats.dist[String(k)] ?? 0, mine: won && attempts === k }));
  bars.push({ k: x.lostCol, n: stats.lost, mine: !won });
  return <DistBars title={x.todayPlayers} bars={bars} uiLang={uiLang} note={pct !== null ? nfmt(x.beat, { p: pct }, uiLang) : nfmt(x.fewPlayers, { n: stats.total }, uiLang)} />;
}

/** The player's own distribution for this mode / language / difficulty. */
function MyDistribution({ won, attempts, uiLang }: { won: boolean; attempts: number; uiLang: Lang }) {
  const session = useApp((s) => s.session);
  const results = useApp((s) => s.results);
  if (!session) return null;
  const st = computeStats(results, { mode: session.mode, lang: session.lang, difficulty: session.difficulty });
  if (st.played < 2) return null;
  const bars = Array.from({ length: session.maxAttempts }, (_, i) => ({ k: String(i + 1), n: st.distribution[i + 1] ?? 0, mine: won && attempts === i + 1 }));
  bars.push({ k: v3(uiLang).lostCol, n: st.played - st.wins, mine: !won });
  return <DistBars title={v3(uiLang).yourDist} bars={bars} uiLang={uiLang} />;
}

function DistBars({ title, bars, uiLang, note }: { title: string; bars: { k: string; n: number; mine: boolean }[]; uiLang: Lang; note?: string }) {
  const max = Math.max(1, ...bars.map((b) => b.n));
  return (
    <motion.section className="dist" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} aria-label={title}>
      <div className="dist__title">{title}</div>
      {note && <div className="dist__note">{note}</div>}
      <div className="dist__bars">
        {bars.map((b, i) => (
          <div key={b.k} className={`dist__col${b.mine ? ' is-mine' : ''}`}>
            <div className="dist__track">
              <motion.div className="dist__fill" initial={{ scaleY: 0 }} animate={{ scaleY: b.n / max }} transition={{ delay: 0.45 + i * 0.05, duration: 0.5 }} />
            </div>
            <div className="dist__n">{num(b.n, uiLang)}</div>
            <div className="dist__k">{/^\d$/.test(b.k) ? num(Number(b.k), uiLang) : b.k}</div>
          </div>
        ))}
      </div>
    </motion.section>
  );
}

function PackProgressLine({ packId, uiLang }: { packId: string; uiLang: Lang }) {
  const solved = useApp((s) => s.packProgress[packId]?.length ?? 0);
  const x = v3(uiLang);
  return (
    <div className="center muted" style={{ fontSize: 13, margin: '6px 0' }}>
      {solved >= PACK_SIZE ? x.packDone : nfmt(x.progress, { n: solved, m: PACK_SIZE }, uiLang)}
    </div>
  );
}

function SpeedSummary() {
  const speed = useApp((s) => s.speed);
  const summary = useApp((s) => s.summary);
  const record = useApp((s) => s.speedRecord);
  const uiLang = useApp((s) => s.prefs.uiLang);
  if (!speed) return null;
  const x = v3(uiLang);
  const solved = speed.words.filter((w) => w.won).length;
  return (
    <div className="center stack" style={{ gap: 8 }}>
      <div className="speed-score">
        <CountUp value={solved} lang={uiLang} />
      </div>
      <div className="muted">{nfmt(x.speedScore, { n: solved }, uiLang)}</div>
      {summary?.won && solved > 0 && <span className="pill">{x.speedNewBest}</span>}
      <div className="muted" style={{ fontSize: 13 }}>
        {nfmt(x.speedBest, { n: record.best[speed.lang] }, uiLang)}
      </div>
      <div className="speed-words">
        {speed.words.map((w, i) => (
          <span key={i} className={`speed-word${w.won ? ' is-won' : ''}`} lang={speed.lang}>
            {w.d}
          </span>
        ))}
      </div>
    </div>
  );
}

function TutorialOutro() {
  const prefs = useApp((s) => s.prefs);
  const setPrefs = useApp((s) => s.setPrefs);
  const x = v3(prefs.uiLang);
  if (prefs.highContrast) return null;
  return (
    <div className="card stack" style={{ marginTop: 12, gap: 8 }}>
      <div style={{ fontSize: 14 }}>{x.tutorialColors}</div>
      <Button onClick={() => setPrefs({ highContrast: true })}>{x.enableColors}</Button>
    </div>
  );
}

/**
 * Learning card: the word's letters flip in one by one, then meaning, Arabic meaning
 * (for English words), pronunciation and an example sentence fade up in sequence.
 */
function LearningCard({ entry, lang, t, uiLang }: { entry: AnswerEntry; lang: Lang; t: (k: StringKey) => string; uiLang: Lang }) {
  const le = getLanguageEngine(lang);
  const x = v3(uiLang);
  const letters = le.toLetters(entry.w);
  return (
    <motion.section className="learn" variants={learnContainer} initial="hidden" animate="show" aria-label={t('learn.title')}>
      <motion.div className="learn__eyebrow" variants={learnBlock}>
        {t('learn.title')}
      </motion.div>
      <motion.div className="learn__word" dir={le.dir} variants={learnLetters}>
        {letters.map((l, i) => (
          <motion.span key={i} className="learn__letter" variants={learnLetter}>
            {le.display(l)}
          </motion.span>
        ))}
      </motion.div>
      {lang === 'ar' && entry.d !== entry.w && (
        <motion.div className="learn__display" variants={learnBlock} lang="ar">
          {entry.d}
        </motion.div>
      )}
      <div className="learn__rows">
        <motion.div variants={learnBlock}>
          <div className="learn__label">
            {t('learn.meaning')} · {entry.c}
          </div>
          <div className="learn__value" lang={lang} dir={le.dir}>
            {entry.m}
          </div>
        </motion.div>
        {entry.t && (
          <motion.div variants={learnBlock}>
            <div className="learn__label">{lang === 'en' ? t('learn.arabic') : x.english}</div>
            <div className="learn__value" lang={lang === 'en' ? 'ar' : 'en'} dir={lang === 'en' ? 'rtl' : 'ltr'} style={{ fontWeight: 600 }}>
              {entry.t}
            </div>
          </motion.div>
        )}
        {entry.r && (
          <motion.div variants={learnBlock}>
            <div className="learn__label">{x.root}</div>
            <div className="learn__value learn__root" lang="ar" dir="rtl">
              {entry.r === 'معرّب' ? x.borrowed : entry.r}
            </div>
          </motion.div>
        )}
        {entry.p && (
          <motion.div variants={learnBlock}>
            <div className="learn__label">{t('learn.pronunciation')}</div>
            <div className="learn__value learn__value--pron" lang={lang} dir={le.dir}>
              {entry.p}
            </div>
          </motion.div>
        )}
        {entry.e && (
          <motion.div variants={learnBlock}>
            <div className="learn__label">{t('learn.example')}</div>
            <div className="learn__value learn__example" lang={lang} dir={le.dir}>
              {entry.e}
            </div>
          </motion.div>
        )}
      </div>
    </motion.section>
  );
}

/** XP earned this round (bar fills across level boundaries) + the streak flame when it grew. */
function GainPanel({ gain, lang }: { gain: RoundGain; lang: Lang }) {
  return (
    <motion.div className="gain" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
      <div className="gain__row">
        <motion.span className="pill xp-pill" initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={{ ...spring.bouncy, delay: 0.35 }}>
          ⭐ +<CountUp value={gain.xp} lang={lang} /> XP
        </motion.span>
        {gain.streak && gain.extended && (
          <motion.span className="gain__streak" initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...spring.bouncy, delay: 0.7 }}>
            <Flame count={gain.streak.count} difficulty={gain.streak.difficulty} size={40} showCount={false} />
            <b>{daysText(gain.streak.count, lang)}</b>
          </motion.span>
        )}
      </div>
      <XpBar from={gain.before} to={gain.after} lang={lang} compact />
    </motion.div>
  );
}
