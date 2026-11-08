import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { revealDuration, rulesOf, useApp, useKeyStates } from '../../app/store';
import { BoardSkeleton } from '../../components/animations/Skeleton';
import { celebrate, resetConfetti } from '../../components/animations/confetti';
import { Board } from '../../components/board/Board';
import { Button, IconButton } from '../../components/buttons/Button';
import { Keyboard } from '../../components/keyboard/Keyboard';
import { Icon } from '../../components/layout/Icon';
import { attemptsLeft } from '../../core/game/game-state';
import type { KeyId } from '../../core/keyboard/keyboard-layouts';
import { getLanguageEngine } from '../../core/localization/localization-engine';
import type { StringKey } from '../../core/localization/ui-strings';
import { computeStats } from '../../core/statistics/statistics-engine';
import { usePhysicalKeyboard } from '../../hooks/usePhysicalKeyboard';
import { spring } from '../../styles/motion';
import type { KeyState, LetterResult } from '../../types';
import { useAssistant } from '../assistant/assistant-store';
import { HintSheet } from './HintSheet';
import { PauseSheet } from './PauseSheet';
import { ResultSheet } from './ResultSheet';
import { remainingMs, SPEED_MS } from '../../core/speed/speed';
import { coachStep } from '../../core/tutorial/tutorial';
import { fmt, num, v3 } from '../v3/strings';
import type { Lang } from '../../types';

export function GameScreen() {
  const session = useApp((s) => s.session);
  const t = useApp((s) => s.t);
  const dictLoading = useApp((s) => s.dictLoading);
  const dictError = useApp((s) => s.dictError);
  const revealingRow = useApp((s) => s.revealingRow);
  const shakeTick = useApp((s) => s.shakeTick);
  const celebrateTick = useApp((s) => s.celebrateTick);
  const prefs = useApp((s) => s.prefs);
  const results = useApp((s) => s.results);
  const { pressKey, pauseGame, quitGame, go } = useApp.getState();
  const keyStates = useKeyStates();
  const [hintsOpen, setHintsOpen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [endReady, setEndReady] = useState(false);

  const engine = session ? getLanguageEngine(session.lang) : null;
  const onKey = useCallback((k: KeyId) => pressKey(k), [pressKey]);
  usePhysicalKeyboard(prefs.physicalKeyboard && session?.status === 'PLAYING', engine, onKey);

  // confetti once the winning row has finished flipping
  useEffect(() => {
    if (celebrateTick === 0) return;
    celebrate(document.documentElement.dataset.motion === 'reduced');
  }, [celebrateTick]);

  // stop any leftover confetti when a new round starts
  const sessionId = session?.id;
  useEffect(() => {
    resetConfetti();
  }, [sessionId]);

  // screen-reader summary of the latest row, after its reveal
  const rowCount = session?.rows.length ?? 0;
  useEffect(() => {
    if (!session || rowCount === 0) return;
    const row = session.rows[rowCount - 1];
    const id = setTimeout(
      () => setAnnounce(row.letters.map((l, i) => `${engine!.display(l)} ${t(`howto.${row.results[i]}` as StringKey)}`).join('، ')),
      revealDuration(session.length),
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowCount]);

  const resultLabel = useCallback((r: LetterResult) => t(`howto.${r}` as StringKey), [t]);
  const stateLabel = useCallback((s: KeyState) => (s === 'disabled' ? t('howto.absent') : t(`howto.${s === 'unused' ? 'absent' : s}` as StringKey)), [t]);

  const sMode = session?.mode;
  const sLang = session?.lang;
  const sDiff = session?.difficulty;
  const infiniteStreak = useMemo(() => {
    if (sMode !== 'infinite' || !sLang || !sDiff) return null;
    return computeStats(results, { mode: 'infinite', lang: sLang, difficulty: sDiff }).currentStreak;
  }, [results, sMode, sLang, sDiff]);

  if (dictError) {
    return (
      <div className="stack center" style={{ margin: 'auto' }}>
        <p>{t('common.error')}</p>
        <Button variant="primary" onClick={() => go('menu', { replace: true })}>
          {t('common.back')}
        </Button>
      </div>
    );
  }

  if (!session || !engine || dictLoading) {
    return (
      <div className="game" aria-busy="true">
        <div className="game__top" />
        <div className="game__board-wrap">
          <BoardSkeleton />
        </div>
        <p className="center muted" style={{ fontSize: 13 }}>
          {t('game.loading')}
        </p>
      </div>
    );
  }

  const rules = rulesOf(session);
  const x = v3(prefs.uiLang);
  const speedLive = session.mode === 'speed';
  const showKeyboard = session.status === 'PLAYING' || (speedLive && !useApp.getState().speed?.over && session.status !== 'COMPLETED');
  const left = attemptsLeft(session);
  const modeLabel = t(`mode.${session.mode}` as StringKey);
  const canHint = rules.maxHints > 0 && session.status === 'PLAYING';
  const textHints = session.hints.filter((h) => h.text);

  return (
    <div className={`game${session.mode === 'tutorial' ? ' game--coach' : ''}${speedLive ? ' game--speed' : ''}`}>
      <div className="game__top">
        <IconButton label={t('game.exit')} onClick={quitGame}>
          <Icon name="close" />
        </IconButton>
        <div className="game__meta">
          <span className="game__mode">
            {session.mode === 'daily' || session.mode === 'archive' ? t('daily.number', { n: session.dailyNumber ?? 1 }) : modeLabel}
            {session.hard && <span className="hard-badge">{x.hardBadge}</span>}
          </span>
          <span className="game__sub">
            {session.topic ? `${session.topic} · ` : ''}
            {t(`diff.${session.difficulty}` as StringKey)} · {t(`lang.${session.lang}` as StringKey)}
            {infiniteStreak !== null && infiniteStreak > 0 && (
              <motion.span key={infiniteStreak} initial={{ scale: 1.5, color: 'var(--danger)' }} animate={{ scale: 1, color: 'var(--muted)' }} transition={spring.bouncy}>
                · {t('game.streak', { n: infiniteStreak })}
              </motion.span>
            )}
          </span>
        </div>
        {session.mode === 'tutorial' ? (
          <button className="skip-btn" onClick={() => useApp.getState().finishTutorial()}>
            {x.skip}
          </button>
        ) : speedLive ? (
          <button className="skip-btn" onClick={() => useApp.getState().endSpeed()} disabled={!!useApp.getState().speed?.over}>
            {x.speedStop}
          </button>
        ) : canHint ? (
          <IconButton label={t('game.hint')} onClick={() => setHintsOpen(true)}>
            <Icon name="hint" />
          </IconButton>
        ) : (
          <IconButton label={t('game.pause')} onClick={pauseGame} disabled={session.status !== 'PLAYING'}>
            <Icon name="pause" />
          </IconButton>
        )}
      </div>

      {speedLive && <SpeedClock lang={prefs.uiLang} />}
      {session.mode !== 'tutorial' && (
      <>
      <div className="attempts" role="status" aria-label={t('game.attemptsLeft', { n: left })}>
        {Array.from({ length: session.maxAttempts }, (_, i) => (
          <span key={i} className={`attempts__dot${i < session.rows.length ? ' attempts__dot--used' : ''}`} />
        ))}
      </div>
      <div className="center muted" style={{ fontSize: 12 }}>
        {t('game.attemptsLeft', { n: left })}
        {canHint && (
          <button onClick={pauseGame} style={{ marginInlineStart: 10, textDecoration: 'underline', color: 'var(--muted)' }}>
            {t('game.pause')}
          </button>
        )}
      </div>
      </>
      )}

      <div className="game__board-wrap">
        <Board session={session} engine={engine} revealingRow={revealingRow} shakeTick={shakeTick} celebrateTick={celebrateTick} resultLabel={resultLabel} />
      </div>

      {textHints.length > 0 && (
        <div className="hint-chips">
          {textHints.map((h) => (
            <motion.span key={h.type} className="hint-chip" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={spring.bouncy}>
              <b>{t(`hint.${h.type}` as StringKey)}:</b> {h.text}
            </motion.span>
          ))}
        </div>
      )}
      {session.mode === 'tutorial' ? (
        <Coach rows={session.rows} status={session.status} lang={session.lang} uiLang={prefs.uiLang} answer={session.reveal?.d ?? ''} />
      ) : (
        rules.showBeginnerHelp && session.rows.length < 2 && session.status === 'PLAYING' && <div className="game__help">{t('game.beginnerHelp')}</div>
      )}

      {!showKeyboard ? (
        <motion.div
          key={`end-${session.id}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: revealDuration(session.length) / 1000 }}
          // not tappable until it has actually appeared (it takes the keyboard's place)
          onAnimationStart={() => setEndReady(false)}
          onAnimationComplete={() => setEndReady(true)}
          style={{ display: 'flex', gap: 10, padding: '10px 0', pointerEvents: endReady ? 'auto' : 'none' }}
        >
          <Button block onClick={() => useApp.setState({ showResult: true })}>
            {t('learn.title')}
          </Button>
          {session.mode === 'custom' ? (
            <Button variant="primary" block onClick={() => useAssistant.getState().openPanel(prefs.uiLang === 'ar' ? 'أنشئ تحدياً جديداً مشابهاً' : 'Make a new similar challenge', { intent: 'build' })}>
              ✨ {t('ai.newChallenge')}
            </Button>
          ) : session.mode === 'tutorial' ? (
            <Button variant="primary" block onClick={() => useApp.getState().finishTutorial()}>
              {x.goMenu}
            </Button>
          ) : (
            session.mode !== 'daily' &&
            session.mode !== 'archive' && (
              <Button variant="primary" block onClick={() => useApp.getState().nextRound()}>
                <Icon name="refresh" /> {session.mode === 'infinite' || session.mode === 'pack' ? t('result.next') : session.mode === 'speed' ? x.speedAgain : t('result.again')}
              </Button>
            )
          )}
        </motion.div>
      ) : (
        <Keyboard engine={engine} states={keyStates} onKey={onKey} enterLabel={session.lang === 'ar' ? 'إدخال' : 'ENTER'} deleteLabel={t('common.back')} stateLabel={stateLabel} />
      )}

      <div className="sr-only" aria-live="polite">
        {announce}
      </div>

      <HintSheet open={hintsOpen} onClose={() => setHintsOpen(false)} />
      <PauseSheet />
      <ResultSheet />
    </div>
  );
}

/** Two-minute clock for speed mode; ends the run when it reaches zero. */
function SpeedClock({ lang }: { lang: Lang }) {
  const run = useApp((s) => s.speed);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!run || run.over) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (remainingMs(run, t) <= 0) useApp.getState().endSpeed();
    }, 250);
    return () => clearInterval(id);
  }, [run]);
  if (!run) return null;
  const left = run.over ? 0 : remainingMs(run, now);
  const sec = Math.ceil(left / 1000);
  const solved = run.words.filter((w) => w.won).length;
  return (
    <div className={`speed-clock${sec <= 10 && !run.over ? ' is-low' : ''}`} role="timer" aria-live="off">
      <span className="speed-clock__time" dir="ltr">
        {num(Math.floor(sec / 60), lang)}:{num(sec % 60, lang).padStart(2, lang === 'ar' ? '٠' : '0')}
      </span>
      <span className="speed-clock__bar">
        <i style={{ transform: `scaleX(${left / SPEED_MS})` }} />
      </span>
      <span className="speed-clock__score">⚡ {num(solved, lang)}</span>
    </div>
  );
}

/** Tutorial coach: explains what the latest row means. */
function Coach({ rows, status, lang, uiLang, answer }: { rows: import('../../types').GuessRow[]; status: string; lang: Lang; uiLang: Lang; answer: string }) {
  const x = v3(uiLang);
  const step = coachStep(rows, status, lang);
  let lines: string[];
  switch (step.kind) {
    case 'type':
      lines = [fmt(x.coachType, { w: step.suggest })];
      break;
    case 'colors':
      lines = step.seen.map((r) => (r === 'correct' ? x.coachGreen : r === 'present' ? x.coachYellow : x.coachGray));
      break;
    case 'use':
      lines = [x.coachUse];
      break;
    case 'won':
      lines = [x.coachWon];
      break;
    case 'lost':
      lines = [fmt(x.coachLost, { w: answer })];
      break;
  }
  return (
    <motion.div key={`${step.kind}-${rows.length}`} className="coach" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: rows.length ? revealDuration(5) / 1000 : 0.2 }} role="status">
      <span className="coach__av" aria-hidden>
        🦉
      </span>
      <span className="coach__body">
        {lines.map((l, i) => (
          <span key={i} className={`coach__line${step.kind === 'colors' ? ` coach__line--${step.seen[i]}` : ''}`}>
            {l}
          </span>
        ))}
      </span>
    </motion.div>
  );
}
