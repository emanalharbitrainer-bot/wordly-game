import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/store';
import type { MatchSeat, MatchState, RpsChoice } from '../../services/social/social-client';
import { spring } from '../../styles/motion';
import { haptic } from '../assistant/assistant-store';
import { colorOf } from '../profile/profile-store';
import { sfx } from '../profile/sfx';
import { useDuel } from './duel-store';
import { sfmt, sx } from './i18n';

/**
 * "Who starts?" — a Rock-Paper-Scissors mini-game before every duel.
 * The server already decided every round (ties included) and the winner; this only *visualizes* it,
 * so skipping, refreshing or reduced motion can never change who starts.
 *
 * Timeline (no ties ≈ 3.0s): intro 380 → 3 synced pumps 900 → simultaneous reveal 480 → winner 950 → out 320.
 * Each tie adds a short "again!" beat and a faster replay.
 */
const HANDS = ['✊', '✋', '✌️'];
const T = { intro: 380, beat: 300, fastBeat: 220, reveal: 480, tie: 560, win: 950, out: 320 };
type Stage = 'intro' | 'pump' | 'reveal' | 'tie' | 'win' | 'out';

export function RpsShowdown({ m }: { m: MatchState }) {
  const lang = useApp((s) => s.prefs.uiLang);
  const s = sx(lang);
  const reduce = useReducedMotion() || document.documentElement.dataset.motion === 'reduced';
  const rps = m.rps!;
  const rounds = rps.rounds;
  const last = rounds.length - 1;
  const [stage, setStage] = useState<Stage>(reduce ? 'reveal' : 'intro');
  const [round, setRound] = useState(reduce ? last : 0);
  const [beat, setBeat] = useState(-1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const done = useRef(false);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    useDuel.getState().finishShowdown();
  };

  const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const winSeq = (t0: number) => {
    at(t0, () => {
      setStage('win');
      sfx.win();
      haptic([15, 40, 25]);
    });
    at(t0 + T.win, () => setStage('out'));
    at(t0 + T.win + T.out, finish);
  };

  useEffect(() => {
    if (reduce) {
      at(450, () => setStage('win'));
      at(1500, finish);
      return clear;
    }
    let t = T.intro;
    rounds.forEach((_, r) => {
      const b = r === 0 ? T.beat : T.fastBeat;
      at(t, () => {
        setRound(r);
        setStage('pump');
        setBeat(-1);
      });
      for (let i = 0; i < 3; i++) {
        at(t + b * (i + 1) - 20, () => {
          setBeat(i);
          sfx.count(i < 2 ? 1 : 0);
          haptic(i < 2 ? 6 : 14);
        });
      }
      t += b * 3;
      at(t, () => {
        setStage('reveal');
        sfx.pop();
      });
      t += T.reveal;
      if (r < last) {
        at(t, () => {
          setStage('tie');
          haptic([8, 30, 8]);
        });
        t += T.tie;
      }
    });
    winSeq(t);
    return clear;
    // the schedule is built once per match; the result is fixed server-side
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id]);

  const skip = () => {
    clear();
    setRound(last);
    setBeat(2);
    setStage('win');
    haptic(10);
    at(650, () => setStage('out'));
    at(650 + T.out, finish);
  };

  // visual sides: left/right regardless of reading direction (seat 1 sits on the reading-start side)
  const rtl = lang === 'ar';
  const leftSeat: 1 | 2 = rtl ? 2 : 1;
  const rightSeat: 1 | 2 = rtl ? 1 : 2;
  const seat = (n: 1 | 2) => m.seats.find((x) => x.seat === n) ?? null;
  const pick = (n: 1 | 2): RpsChoice => rounds[round][n - 1];
  const showChoice = stage === 'reveal' || stage === 'tie' || stage === 'win' || stage === 'out';
  const winner = rps.winner;
  const decided = stage === 'win' || stage === 'out';
  const beatMs = round === 0 ? T.beat : T.fastBeat;

  const caption = useMemo(() => {
    if (decided) {
      const w = seat(winner);
      return { key: 'w', text: winner === m.mySeat ? s.rps.youStart : sfmt(s.rps.starts, { name: w?.name ?? '' }), tone: 'win' };
    }
    if (stage === 'tie') return { key: `t${round}`, text: s.rps.tie, tone: 'tie' };
    if (stage === 'reveal') {
      const a = pick(1);
      const b = pick(2);
      if (a === b) return { key: `r${round}`, text: `${HANDS[a]} = ${HANDS[b]}`, tone: 'tie' };
      const [wc, lc] = (a - b + 3) % 3 === 1 ? [a, b] : [b, a];
      return { key: `r${round}`, text: sfmt(s.rps.beats, { a: s.rps.names[wc], b: s.rps.names[lc] }), tone: 'info' };
    }
    if (stage === 'pump' && beat >= 0) return { key: `b${round}${beat}`, text: s.rps.chant[beat], tone: beat === 2 ? 'shoot' : 'chant' };
    return { key: 'title', text: '', tone: 'chant' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, beat, round, decided]);

  return (
    <motion.div
      className={`rps rps--${stage}`}
      initial={{ opacity: 0 }}
      animate={stage === 'out' ? { opacity: 0, scale: 1.06 } : { opacity: 1, scale: 1 }}
      transition={{ duration: stage === 'out' ? T.out / 1000 : 0.25, ease: [0.22, 1, 0.36, 1] }}
      role="dialog"
      aria-label={s.whoStarts}
      aria-live="polite"
    >
      <div className="rps__bg" aria-hidden />
      <motion.div className="rps__head" initial={{ y: -24, opacity: 0, scale: 0.9 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ ...spring.bouncy, delay: 0.05 }}>
        <div className="rps__eyebrow">⚔️ {s.duelTitle}</div>
        <h2 className="rps__title">{s.whoStarts}</h2>
        <AnimatePresence>
          {rounds.length > 1 && round > 0 && !decided && (
            <motion.div className="rps__round" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={spring.bouncy}>
              {sfmt(s.rps.round, { n: round + 1 })}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="rps__stage" dir="ltr">
        {[leftSeat, rightSeat].map((n, i) => (
          <Player
            key={n}
            p={seat(n)}
            side={i === 0 ? 'left' : 'right'}
            me={m.mySeat === n}
            choice={showChoice ? pick(n) : 0}
            reveal={showChoice}
            round={round}
            pumping={stage === 'pump'}
            beatMs={beatMs}
            state={decided ? (winner === n ? 'win' : 'lose') : stage === 'tie' ? 'tie' : 'idle'}
            youLabel={lang === 'ar' ? 'أنت' : 'You'}
          />
        ))}
        <motion.div
          className="rps__vs"
          key={`vs${round}-${beat}`}
          initial={beat >= 0 ? { scale: 1.45 } : { scale: 0, rotate: -90 }}
          animate={{ scale: decided ? 0 : 1, rotate: 0, opacity: decided ? 0 : 1 }}
          transition={beat >= 0 ? { type: 'spring', stiffness: 600, damping: 16 } : { ...spring.bouncy, delay: 0.15 }}
        >
          VS
        </motion.div>
      </div>

      <div className="rps__caption">
        <AnimatePresence mode="popLayout">
          {caption.text && (
            <motion.div
              key={caption.key}
              className={`rps__say rps__say--${caption.tone}`}
              initial={{ y: 14, opacity: 0, scale: 0.8 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -10, opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 22 }}
            >
              {caption.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!decided && !reduce && (
        <motion.button className="rps__skip" onClick={skip} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} whileTap={{ scale: 0.92 }}>
          {s.rps.skip} ⏭
        </motion.button>
      )}
    </motion.div>
  );
}

function Player({
  p, side, me, choice, reveal, round, pumping, beatMs, state, youLabel,
}: {
  p: MatchSeat | null; side: 'left' | 'right'; me: boolean; choice: RpsChoice; reveal: boolean; round: number; pumping: boolean; beatMs: number; state: 'idle' | 'tie' | 'win' | 'lose'; youLabel: string;
}) {
  const col = colorOf(p?.color ?? 'slate');
  const from = side === 'left' ? -90 : 90;
  return (
    <motion.div
      className={`rps__p rps__p--${side} is-${state}`}
      style={{ ['--pc' as string]: col }}
      initial={{ x: from, opacity: 0 }}
      animate={{ x: 0, opacity: state === 'lose' ? 0.5 : 1, scale: state === 'win' ? 1.08 : state === 'lose' ? 0.92 : 1 }}
      transition={state === 'idle' ? { type: 'spring', stiffness: 300, damping: 22 } : spring.bouncy}
    >
      <div className="rps__av">
        <span className="rps__face">{p?.avatar ?? '…'}</span>
        {state === 'win' && (
          <>
            <span className="rps__ring" />
            <span className="rps__ring rps__ring--2" />
            <motion.span className="rps__crown" initial={{ y: -46, rotate: -35, opacity: 0 }} animate={{ y: 0, rotate: side === 'left' ? -14 : 14, opacity: 1 }} transition={{ ...spring.bouncy, delay: 0.08 }}>
              👑
            </motion.span>
            <Sparks />
          </>
        )}
      </div>
      <div className="rps__name">
        <b className="ellipsis">{p?.name ?? '…'}</b>
        {me && <small>{youLabel}</small>}
      </div>

      {/* outer wrapper mirrors the right hand so both arms run the very same (synchronized) animation */}
      <div className={`rps__arm-wrap${side === 'right' ? ' is-mirror' : ''}`}>
        <motion.div
          className="rps__arm"
          key={`arm${round}`}
          initial={{ rotate: -8 }}
          animate={
            pumping
              ? { rotate: [-8, -34, 4, -34, 4, -34, 0] }
              : state === 'win'
                ? { rotate: [0, -18, 0], y: [0, -6, 0] }
                : state === 'lose'
                  ? { rotate: 18, y: 6 }
                  : { rotate: 0 }
          }
          transition={
            pumping
              ? { duration: (beatMs * 3) / 1000, times: [0, 0.17, 0.33, 0.5, 0.67, 0.83, 1], ease: ['easeOut', 'easeIn', 'easeOut', 'easeIn', 'easeOut', 'easeIn'] }
              : state === 'win'
                ? { duration: 0.5, ease: 'easeOut' }
                : spring.soft
          }
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={reveal ? `c${round}-${choice}` : `fist${round}`}
              className="rps__hand"
              initial={reveal ? { scale: 0.3, opacity: 0 } : { scale: 1, opacity: 1 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0, transition: { duration: 0.08 } }}
              transition={reveal ? { type: 'spring', stiffness: 700, damping: 14 } : { duration: 0 }}
            >
              <span className="rps__emoji">{HANDS[reveal ? choice : 0]}</span>
            </motion.span>
          </AnimatePresence>
          {reveal && <span className="rps__flash" key={`f${round}`} />}
        </motion.div>
      </div>
    </motion.div>
  );
}

function Sparks() {
  const parts = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ a: (i / 14) * Math.PI * 2, d: 54 + (i % 3) * 16, c: ['#d9a62e', '#2f9e6e', '#e2614b', '#8b5cf6'][i % 4] })), []);
  return (
    <span className="rps__sparks" aria-hidden>
      {parts.map((p, i) => (
        <motion.i
          key={i}
          style={{ background: p.c }}
          initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
          animate={{ x: Math.cos(p.a) * p.d, y: Math.sin(p.a) * p.d, scale: 0.2, opacity: 0 }}
          transition={{ duration: 0.75, ease: [0.2, 0.8, 0.3, 1] }}
        />
      ))}
    </span>
  );
}
