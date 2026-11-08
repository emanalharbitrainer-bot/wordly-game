import { AnimatePresence, motion, useAnimate } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/store';
import { celebrate, resetConfetti } from '../../components/animations/confetti';
import { Button, IconButton } from '../../components/buttons/Button';
import { Keyboard } from '../../components/keyboard/Keyboard';
import { Icon } from '../../components/layout/Icon';
import { Sheet } from '../../components/modals/Sheet';
import type { KeyId } from '../../core/keyboard/keyboard-layouts';
import { computeKeyStates } from '../../core/keyboard/keyboard-state';
import { getLanguageEngine } from '../../core/localization/localization-engine';
import { usePhysicalKeyboard } from '../../hooks/usePhysicalKeyboard';
import * as api from '../../services/social/social-client';
import { SHAKE_TRANSITION, SHAKE_X, spring } from '../../styles/motion';
import type { Difficulty, KeyState } from '../../types';
import { shareText } from '../../utils/share';
import { haptic } from '../assistant/assistant-store';
import { colorOf, useProfile } from '../profile/profile-store';
import { rowsOf, seatOf, useDuel } from './duel-store';
import { num, sfmt, sx } from './i18n';
import { RpsShowdown } from './RpsShowdown';

const ATTEMPTS: (number | null)[] = [4, 6, 8, 10, 12, 16, null];
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard', 'expert'];
const AR_LETTERS = [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'];
const EN_LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

export default function DuelScreen() {
  const phase = useDuel((s) => s.phase);
  const match = useDuel((s) => s.match);
  return (
    <div className="duel" data-phase={phase}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={phase === 'countdown' ? 'playing' : phase}
          className="duel__phase"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12, transition: { duration: 0.16 } }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          {phase === 'setup' && <Setup />}
          {phase === 'creating' && <Creating />}
          {phase === 'loading' && <Loading />}
          {phase === 'error' && <ErrorView />}
          {phase === 'preview' && <Preview />}
          {phase === 'lobby' && <Lobby />}
          {(phase === 'playing' || phase === 'countdown' || phase === 'finished') && <Arena />}
        </motion.div>
      </AnimatePresence>
      <AnimatePresence>{phase === 'countdown' && match?.rps && <RpsShowdown key={`rps-${match.id}`} m={match} />}</AnimatePresence>
    </div>
  );
}

function TopBar({ title, end, onBack }: { title: string; end?: React.ReactNode; onBack?: () => void }) {
  const back = useApp((s) => s.back);
  const t = useApp((s) => s.t);
  return (
    <header className="header">
      <IconButton
        label={t('common.back')}
        onClick={() => {
          useDuel.getState().leave();
          (onBack ?? back)();
        }}
      >
        <Icon name="back" className="flip-rtl" />
      </IconButton>
      <div className="grow">
        <h1 className="header__title">{title}</h1>
      </div>
      {end}
    </header>
  );
}

// ───────────────────────── setup ─────────────────────────

function Setup() {
  const lang = useApp((s) => s.prefs.uiLang);
  const t = useApp((s) => s.t);
  const s = sx(lang);
  const { setup, setSetup, create, invite, error } = useDuel();
  const identity = useProfile((x) => x.identity);
  const letters = setup.lang === 'ar' ? AR_LETTERS : EN_LETTERS;
  const sample = useMemo(() => Array.from({ length: 8 }, (_, i) => letters[(i * 7 + 3) % letters.length]), [letters]);

  return (
    <>
      <TopBar title={s.setup} />
      <div className="dsetup">
        <motion.div className="dsetup__hero" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.soft}>
          <div className="vs">
            <motion.span className="vs__av" style={{ background: colorOf(identity.color) }} initial={{ x: lang === 'ar' ? 40 : -40, rotate: -20 }} animate={{ x: 0, rotate: 0 }} transition={spring.bouncy}>
              {identity.avatar}
            </motion.span>
            <motion.span className="vs__x" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ ...spring.bouncy, delay: 0.15 }}>
              ⚔️
            </motion.span>
            <motion.span className="vs__av vs__av--q" initial={{ x: lang === 'ar' ? -40 : 40, rotate: 20 }} animate={{ x: 0, rotate: 0 }} transition={spring.bouncy}>
              {invite ? '👤' : '?'}
            </motion.span>
          </div>
          <p className="dsetup__desc">{invite ? `${s.challenge} ${invite.inviteName} · @${invite.invite}` : s.duelDesc}</p>
        </motion.div>

        <div className="bld-label">{s.wordLang}</div>
        <div className="bld-seg seg-slider" data-on={setup.lang === 'en' ? 1 : 0}>
          {(['ar', 'en'] as const).map((l) => (
            <button key={l} className={setup.lang === l ? 'is-on' : ''} onClick={() => (haptic(5), setSetup({ lang: l }))}>
              <span>{l === 'ar' ? 'عربي' : 'English'}</span>
            </button>
          ))}
        </div>

        <div className="bld-label">
          {s.letters} · <b>{num(setup.length, lang)}</b>
        </div>
        <div className="dsetup__len" dir={setup.lang === 'ar' ? 'rtl' : 'ltr'}>
          {[3, 4, 5, 6, 7, 8].map((n) => (
            <motion.button key={n} className={`dsetup__lenbtn${setup.length === n ? ' is-on' : ''}`} whileTap={{ scale: 0.9 }} onClick={() => (haptic(5), setSetup({ length: n }))}>
              {num(n, lang)}
            </motion.button>
          ))}
        </div>
        <div className="dsetup__tiles" dir={setup.lang === 'ar' ? 'rtl' : 'ltr'}>
          <AnimatePresence mode="popLayout" initial={false}>
            {sample.slice(0, setup.length).map((l, i) => (
              <motion.span
                key={`${setup.lang}${i}`}
                className={`tile tile--settled ${i % 3 === 0 ? 'tile--correct' : i % 3 === 1 ? 'tile--present' : 'tile--absent'}`}
                style={{ ['--i' as string]: i, width: 34, height: 34, fontSize: 16 }}
                initial={{ scale: 0, rotateX: -90 }}
                animate={{ scale: 1, rotateX: 0 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ ...spring.bouncy, delay: i * 0.03 }}
              >
                {l}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>

        <div className="bld-label">{s.attempts}</div>
        <div className="dsetup__att">
          {ATTEMPTS.map((a) => (
            <motion.button key={String(a)} whileTap={{ scale: 0.9 }} className={`chip${setup.maxAttempts === a ? ' is-on' : ''}`} onClick={() => (haptic(5), setSetup({ maxAttempts: a }))}>
              {setup.maxAttempts === a && <motion.span layoutId="att-chip" className="chip__bg" transition={spring.snappy} />}
              <span>
                <b>{a ? num(a, lang) : '∞'}</b>
                <small>{a ? sfmt(s.perPlayer, { n: num(a / 2, lang) }) : s.unlimited}</small>
              </span>
            </motion.button>
          ))}
        </div>

        <div className="bld-label">{s.difficulty}</div>
        <div className="bld-diffs">
          {DIFFS.map((d) => (
            <motion.button key={d} whileTap={{ scale: 0.94 }} className={`bld-diff d-${d}${setup.difficulty === d ? ' is-on' : ''}`} onClick={() => (haptic(5), setSetup({ difficulty: d }))}>
              {t(`diff.${d}` as never)}
            </motion.button>
          ))}
        </div>

        <div className="bld-label">{s.whoStarts}</div>
        <div className="dsetup__rps">
          {['✊', '✋', '✌️'].map((h, i) => (
            <motion.span key={h} animate={{ rotate: [0, -18, 0] }} transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.15, repeatDelay: 1.4 }}>
              {h}
            </motion.span>
          ))}
          <small>{s.rps.note}</small>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div className="acc__err" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {sx(lang).err[error] ?? sx(lang).err.server}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="dsetup__footer">
        <motion.button className="ai-cta ai-cta--big duel-cta" whileTap={{ scale: 0.97 }} onClick={() => void create()}>
          ⚔️ {s.create}
        </motion.button>
      </div>
    </>
  );
}

// ───────────────────────── creating (slot-machine word pick) ─────────────────────────

function Creating() {
  const lang = useApp((s) => s.prefs.uiLang);
  const setup = useDuel((s) => s.setup);
  const s = sx(lang);
  const letters = setup.lang === 'ar' ? AR_LETTERS : EN_LETTERS;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 90);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="dcreate">
      <div className="dcreate__slots" dir={setup.lang === 'ar' ? 'rtl' : 'ltr'}>
        {Array.from({ length: setup.length }, (_, i) => (
          <motion.span key={i} className="tile tile--filled dcreate__slot" animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.08 }}>
            <AnimatePresence mode="popLayout">
              <motion.span key={tick} initial={{ y: -22, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 22, opacity: 0 }} transition={{ duration: 0.08 }}>
                {letters[(tick * (i + 3) + i * 5) % letters.length]}
              </motion.span>
            </AnimatePresence>
          </motion.span>
        ))}
      </div>
      <div className="dcreate__orb" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <h2>{s.creating}</h2>
      <p className="muted">{s.creatingSub}</p>
    </div>
  );
}

function Loading() {
  return (
    <div className="dcreate">
      <div className="dcreate__orb" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function ErrorView() {
  const lang = useApp((s) => s.prefs.uiLang);
  const error = useDuel((s) => s.error);
  const s = sx(lang);
  return (
    <>
      <TopBar title={s.duelTitle} />
      <div className="dcreate">
        <motion.div initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={spring.bouncy} style={{ fontSize: 56 }}>
          🫥
        </motion.div>
        <p>{error === 'missing' ? s.notFound : (s.err[error ?? 'server'] ?? s.err.server)}</p>
        <Button variant="primary" onClick={() => useDuel.getState().prepare()}>
          ⚔️ {s.newDuel}
        </Button>
      </div>
    </>
  );
}

// ───────────────────────── lobby ─────────────────────────

function Summary({ m }: { m: api.MatchState }) {
  const lang = useApp((s) => s.prefs.uiLang);
  const t = useApp((s) => s.t);
  const s = sx(lang);
  return (
    <div className="dsum">
      <span>{m.lang === 'ar' ? '🇸🇦 عربي' : '🇬🇧 English'}</span>
      <span>
        🔤 {num(m.length, lang)} {lang === 'ar' ? 'حروف' : 'letters'}
      </span>
      <span>🎯 {m.maxAttempts ? sfmt(s.perPlayer, { n: num(m.maxAttempts / 2, lang) }) : `∞ ${s.unlimited}`}</span>
      <span>📈 {t(`diff.${m.difficulty}` as never)}</span>
    </div>
  );
}

function Lobby() {
  const lang = useApp((s) => s.prefs.uiLang);
  const showToast = useApp((s) => s.showToast);
  const m = useDuel((s) => s.match)!;
  const invite = useDuel((s) => s.invite);
  const s = sx(lang);
  const me = seatOf(m, m.mySeat);
  const link = api.matchLink(m.id);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      haptic(8);
      showToast(s.copied, 'success');
    } catch {
      /* ignore */
    }
  };
  const share = async () => {
    const r = await shareText(`${sfmt(s.shareText, { name: me?.name ?? '' })}\n${link}`);
    if (r === 'copied') showToast(s.copied, 'success');
  };
  return (
    <>
      <TopBar title={s.lobby} />
      <div className="dlobby">
        <div className="radar" aria-hidden>
          <span className="radar__ring" />
          <span className="radar__ring" style={{ animationDelay: '0.8s' }} />
          <span className="radar__ring" style={{ animationDelay: '1.6s' }} />
          <motion.span className="radar__me" style={{ background: colorOf(me?.color ?? 'green') }} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring.bouncy}>
            {me?.avatar}
          </motion.span>
          <span className="radar__orbit">
            <span className="radar__q">?</span>
          </span>
        </div>
        <p className="muted center">{invite ? sfmt(s.inviteFrom, { name: me?.name ?? '' }).replace(me?.name ?? '', `→ ${invite.inviteName}`) : s.waiting}</p>
        <div className="code-tiles" dir="ltr" aria-label={`${s.code} ${m.id}`}>
          {[...m.id].map((c, i) => (
            <motion.span key={i} className="tile tile--correct tile--settled" style={{ ['--i' as string]: i }} initial={{ rotateX: -90, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} transition={{ ...spring.bouncy, delay: 0.1 + i * 0.07 }}>
              {c}
            </motion.span>
          ))}
        </div>
        <Summary m={m} />
        <div className="stack" style={{ width: '100%' }}>
          <Button variant="primary" block onClick={() => void share()}>
            <Icon name="share" /> {s.shareLink}
          </Button>
          <Button block onClick={() => void copy()}>
            🔗 {s.copyLink}
          </Button>
        </div>
        <div className="dots-wait" aria-hidden>
          <span />
          <span />
          <span />
        </div>
      </div>
    </>
  );
}

// ───────────────────────── preview (join) ─────────────────────────

function Preview() {
  const lang = useApp((s) => s.prefs.uiLang);
  const m = useDuel((s) => s.match)!;
  const busy = useDuel((s) => s.busy);
  const { identity, setIdentity } = useProfile();
  const [name, setName] = useState(identity.name);
  const s = sx(lang);
  const host = seatOf(m, 1);
  return (
    <>
      <TopBar title={s.joinTitle} />
      <div className="dlobby">
        <div className="vs vs--big">
          <motion.span className="vs__av" style={{ background: colorOf(host?.color ?? 'green') }} initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring.bouncy}>
            {host?.avatar}
          </motion.span>
          <motion.span className="vs__x" initial={{ scale: 0 }} animate={{ scale: [0, 1.4, 1] }} transition={{ delay: 0.25, duration: 0.5 }}>
            ⚔️
          </motion.span>
          <motion.span className="vs__av" style={{ background: colorOf(identity.color) }} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...spring.bouncy, delay: 0.1 }}>
            {identity.avatar}
          </motion.span>
        </div>
        <h2 className="center" style={{ margin: 0 }}>
          {sfmt(s.inviteFrom, { name: host?.name ?? '' })}
        </h2>
        <Summary m={m} />
        <label className="field" style={{ width: '100%' }}>
          <span>{s.joinAs}</span>
          <input className="input" value={name} maxLength={24} dir="auto" placeholder={s.namePh} onChange={(e) => setName(e.target.value)} />
        </label>
        <Button
          variant="primary"
          block
          disabled={busy}
          className="duel-cta"
          onClick={() => {
            if (name.trim()) setIdentity({ name: name.trim() });
            void useDuel.getState().join();
          }}
        >
          {busy ? s.joining : `⚔️ ${s.join}`}
        </Button>
      </div>
    </>
  );
}

// ───────────────────────── arena ─────────────────────────

function Arena() {
  const lang = useApp((s) => s.prefs.uiLang);
  const t = useApp((s) => s.t);
  const physical = useApp((s) => s.prefs.physicalKeyboard);
  const { match: m, current, revealing, phase, feed, floats, press, react, shakeTick } = useDuel();
  const s = sx(lang);
  const [resignOpen, setResignOpen] = useState(false);
  const engine = m ? getLanguageEngine(m.lang) : null;
  const rows = useMemo(() => rowsOf(m), [m]);
  const visibleRows = revealing === null ? rows : rows.slice(0, revealing);
  const keyStates = useMemo(() => computeKeyStates(visibleRows, false), [visibleRows]);
  const onKey = useCallback((k: KeyId) => press(k), [press]);
  const myTurn = !!m && m.status === 'playing' && m.turn === m.mySeat && phase === 'playing';
  usePhysicalKeyboard(physical && myTurn, engine, onKey);
  const resultLabel = (r: string) => t(`howto.${r}` as never);
  const stateLabel = useCallback((st: KeyState) => t(`howto.${st === 'unused' || st === 'disabled' ? 'absent' : st}` as never), [t]);

  if (!m || !engine) return null;
  const me = seatOf(m, m.mySeat);
  const turnSeat = seatOf(m, m.turn);
  const left = m.maxAttempts ? m.maxAttempts - m.rows.length : null;

  return (
    <div className="arena">
      <div className="game__top">
        <IconButton
          label={s.leave}
          onClick={() => {
            useDuel.getState().leave();
            useApp.getState().go('menu', { replace: true });
          }}
        >
          <Icon name="close" />
        </IconButton>
        <div className="game__meta">
          <span className="game__mode">
            ⚔️ {s.duelTitle} <span dir="ltr" className="muted" style={{ fontSize: 12 }}>#{m.id}</span>
          </span>
          <span className="game__sub">{left === null ? s.rowsInf : sfmt(s.rowsLeft, { n: num(Math.max(0, left), lang) })}</span>
        </div>
        {m.mySeat && m.status === 'playing' ? (
          <IconButton label={s.resign} onClick={() => setResignOpen(true)}>
            <span style={{ fontSize: 18 }}>🏳️</span>
          </IconButton>
        ) : (
          <span style={{ width: 40 }} />
        )}
      </div>

      <Versus m={m} />

      <div className="arena__turn" aria-live="polite">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${m.status}-${m.turn}-${m.mySeat}`}
            className={`turn-pill${myTurn ? ' is-mine' : ''}`}
            initial={{ y: 12, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -12, opacity: 0, scale: 0.9 }}
            transition={spring.snappy}
            style={{ ['--tc' as string]: colorOf(turnSeat?.color ?? 'green') }}
          >
            {m.status !== 'playing' ? (m.mySeat ? '🏁' : s.spectating) : myTurn ? `✨ ${s.yourTurn}` : (
              <>
                {turnSeat?.avatar} {sfmt(s.thinking, { name: turnSeat?.name ?? '' })} <span className="typing"><i /><i /><i /></span>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="arena__board-wrap">
        <DuelBoard m={m} rows={rows} current={myTurn ? current : []} revealing={revealing} shakeTick={shakeTick} resultLabel={resultLabel} />
        <div className="feed" aria-live="polite">
          <AnimatePresence>
            {feed.map((f) => (
              <motion.div key={f.id} layout className={`feed__line feed--${f.tone}`} initial={{ opacity: 0, y: 14, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.95 }} transition={spring.snappy}>
                🎙️ {f.text}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <div className="floats" aria-hidden>
          <AnimatePresence>
            {floats.map((f) => (
              <motion.span
                key={f.id}
                className="floats__e"
                style={{ insetInlineStart: `${f.x}%` }}
                initial={{ y: 0, opacity: 0, scale: 0.4 }}
                animate={{ y: -220, opacity: [0, 1, 1, 0], scale: [0.4, 1.4, 1.1, 1], rotate: [0, -12, 10, 0] }}
                transition={{ duration: 2.4, ease: 'easeOut' }}
              >
                {f.e}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {m.mySeat && (
        <div className="reacts">
          {api.REACTIONS.map((e) => (
            <motion.button key={e} whileTap={{ scale: 0.7, rotate: -15 }} whileHover={{ y: -3 }} onClick={() => react(e)} aria-label={e}>
              {e}
            </motion.button>
          ))}
        </div>
      )}

      <div className={`arena__kb${myTurn ? '' : ' is-locked'}`}>
        <Keyboard engine={engine} states={keyStates} onKey={onKey} enterLabel={m.lang === 'ar' ? 'إدخال' : 'ENTER'} deleteLabel={t('common.back')} stateLabel={stateLabel} />
        <AnimatePresence>
          {!myTurn && m.status === 'playing' && m.mySeat && (
            <motion.div className="arena__lock" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <span>
                {turnSeat?.avatar} {sfmt(s.theirTurn, { name: turnSeat?.name ?? '' })}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Sheet open={resignOpen} onClose={() => setResignOpen(false)} label={s.resign}>
        <h2 className="sheet__title">{s.resignConfirm}</h2>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <Button block onClick={() => setResignOpen(false)}>
            {s.no}
          </Button>
          <Button
            block
            variant="primary"
            onClick={() => {
              setResignOpen(false);
              void useDuel.getState().resign();
            }}
          >
            {s.yes}
          </Button>
        </div>
      </Sheet>

      <FinishedSheet open={phase === 'finished'} me={me?.seat ?? null} />
    </div>
  );
}

function Versus({ m }: { m: api.MatchState }) {
  const lang = useApp((s) => s.prefs.uiLang);
  const s = sx(lang);
  return (
    <div className="versus">
      {[1, 2].map((seat) => {
        const p = seatOf(m, seat as 1 | 2);
        const active = m.status === 'playing' && m.turn === seat;
        const mine = m.mySeat === seat;
        const n = m.rows.filter((r) => r.seat === seat).length;
        return (
          <motion.div key={seat} className={`vchip${active ? ' is-active' : ''}${mine ? ' is-me' : ''}`} style={{ ['--pc' as string]: colorOf(p?.color ?? 'slate') }} animate={active ? { scale: 1.04 } : { scale: 0.97 }} transition={spring.snappy}>
            {active && <motion.span layoutId="turn-glow" className="vchip__glow" transition={spring.soft} />}
            <span className="vchip__av">
              {p?.avatar ?? '…'}
              <i className={`vchip__dot${p?.online ? ' is-on' : ''}`} title={p?.online ? '' : s.offline} />
            </span>
            <span className="vchip__body">
              <b className="ellipsis">{p?.name ?? '…'}</b>
              <small>
                {mine ? (lang === 'ar' ? 'أنت' : 'You') : ''} {num(n, lang)} {lang === 'ar' ? 'محاولة' : 'tries'}
              </small>
            </span>
            {m.winner === seat && (
              <motion.span className="vchip__crown" initial={{ y: -30, rotate: -30, opacity: 0 }} animate={{ y: 0, rotate: 0, opacity: 1 }} transition={spring.bouncy}>
                👑
              </motion.span>
            )}
          </motion.div>
        );
      })}
      <div className="versus__score">
        <motion.b key={`a${m.series.s1}`} initial={{ scale: 1.8 }} animate={{ scale: 1 }} transition={spring.bouncy}>
          {m.series.s1}
        </motion.b>
        <span>:</span>
        <motion.b key={`b${m.series.s2}`} initial={{ scale: 1.8 }} animate={{ scale: 1 }} transition={spring.bouncy}>
          {m.series.s2}
        </motion.b>
      </div>
    </div>
  );
}

function DuelBoard({ m, rows, current, revealing, shakeTick, resultLabel }: { m: api.MatchState; rows: ReturnType<typeof rowsOf>; current: string[]; revealing: number | null; shakeTick: number; resultLabel(r: string): string }) {
  const engine = getLanguageEngine(m.lang);
  const [scope, animate] = useAnimate();
  const first = useRef(shakeTick);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (shakeTick === first.current || !scope.current) return;
    void animate(scope.current, { x: SHAKE_X }, SHAKE_TRANSITION);
  }, [shakeTick, animate, scope]);
  const playing = m.status === 'playing';
  const total = m.maxAttempts ?? Math.max(6, rows.length + (playing ? 2 : 0));
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [rows.length]);
  const winRow = m.result === 'win' ? rows.length - 1 : -1;

  return (
    <div className="dboard-scroll" ref={scroller}>
      <div className="board dboard" dir={engine.dir} role="grid" style={{ ['--rows' as string]: Math.min(total, 8), ['--cols' as string]: m.length }}>
        {Array.from({ length: total }, (_, r) => {
          const row = rows[r];
          const isCurrent = r === rows.length && playing;
          const seat = row?.seat ?? (isCurrent ? m.turn : null);
          const col = seat ? colorOf(seatOf(m, seat)?.color ?? 'slate') : 'transparent';
          const letters = row ? row.letters : isCurrent ? current : [];
          const tiles = Array.from({ length: m.length }, (_, i) => {
            const l = letters[i] ?? '';
            const res = row?.results[i];
            const shown = l ? engine.display(l) : '';
            const cls = ['tile'];
            if (l && !res) cls.push('tile--filled', 'tile--pop');
            if (res) cls.push(`tile--${res}`, r === revealing ? 'tile--revealing' : 'tile--settled');
            if (r === winRow && revealing === null) cls.push('tile--bounce');
            return (
              <div key={isCurrent ? `${i}-${l}` : i} className={cls.join(' ')} style={{ ['--i' as string]: i }} role="gridcell" aria-label={shown ? `${shown}${res ? `, ${resultLabel(res)}` : ''}` : '—'}>
                {shown}
                <span className="tile__mark" aria-hidden />
              </div>
            );
          });
          return (
            <motion.div
              key={r}
              ref={isCurrent ? scope : undefined}
              className={`board__row dboard__row${isCurrent ? ' is-current' : ''}`}
              role="row"
              style={{ ['--seat' as string]: col }}
              initial={r >= (m.maxAttempts ?? 0) && !row ? { opacity: 0, y: 10 } : false}
              animate={{ opacity: 1, y: 0 }}
            >
              <span className="dboard__seat" aria-hidden>
                {seat ? seatOf(m, seat)?.avatar : ''}
              </span>
              {tiles}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function FinishedSheet({ open, me }: { open: boolean; me: 1 | 2 | null }) {
  const lang = useApp((s) => s.prefs.uiLang);
  const showToast = useApp((s) => s.showToast);
  const { match: m, xpGain, rematch, rematching } = useDuel();
  const s = sx(lang);
  const [dismissed, setDismissed] = useState(false);
  const won = !!m && !!me && m.winner === me;
  useEffect(() => {
    setDismissed(false);
    if (open && won) celebrate(document.documentElement.dataset.motion === 'reduced');
    return () => {
      resetConfetti();
    };
  }, [open, won, m?.id]);
  if (!m) return null;
  const winner = seatOf(m, m.winner);
  const loser = seatOf(m, m.winner ? (3 - m.winner) as 1 | 2 : null);
  const title = m.result === 'draw' ? s.draw : m.result === 'resign' ? (m.winner === me ? sfmt(s.resigned, { name: loser?.name ?? '' }) : s.youResigned) : won ? s.youWon : sfmt(s.youLost, { name: winner?.name ?? '' });
  const a = m.answer;
  const le = getLanguageEngine(m.lang);
  const shareResult = async () => {
    const grid = m.rows.map((r) => (r.seat === 1 ? '🅰️' : '🅱️') + [...r.pattern].map((c) => (c === 'C' ? '🟩' : c === 'P' ? '🟨' : '⬜')).join('')).join('\n');
    const txt = `⚔️ WORDLY ${s.duelTitle} #${m.id}\n${seatOf(m, 1)?.name} ${m.series.s1} : ${m.series.s2} ${seatOf(m, 2)?.name}\n${grid}\n${location.origin}`;
    const r = await shareText(txt);
    if (r === 'copied') showToast(s.copied, 'success');
  };

  return (
    <Sheet open={open && !dismissed} onClose={() => setDismissed(true)} label={title}>
      <div className="dfin">
        <motion.div className="dfin__hero" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...spring.bouncy, delay: 0.1 }}>
          {m.result === 'draw' ? (
            <span className="dfin__av">🤝</span>
          ) : (
            <span className="dfin__av" style={{ background: colorOf(winner?.color ?? 'gold') }}>
              {winner?.avatar}
              <motion.span className="dfin__crown" initial={{ y: -60, rotate: -40, opacity: 0 }} animate={{ y: 0, rotate: -12, opacity: 1 }} transition={{ ...spring.bouncy, delay: 0.45 }}>
                👑
              </motion.span>
            </span>
          )}
        </motion.div>
        <h2 className="sheet__title">{title}</h2>
        <div className="dfin__score" dir="ltr">
          <span>{seatOf(m, 1)?.avatar}</span>
          <b>{m.series.s1}</b>
          <span className="muted">—</span>
          <b>{m.series.s2}</b>
          <span>{seatOf(m, 2)?.avatar}</span>
        </div>
        {xpGain ? (
          <motion.div className="center" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
            <span className="pill xp-pill">⭐ {sfmt(s.xpGain, { n: num(xpGain, lang) })}</span>
          </motion.div>
        ) : null}
        {a && (
          <div className="dfin__word">
            <div className="learn__eyebrow">{s.theWord}</div>
            <div className="learn__word" dir={le.dir}>
              {le.toLetters(a.w).map((l, i) => (
                <motion.span key={i} className="learn__letter" initial={{ rotateX: -90, opacity: 0, y: 12 }} animate={{ rotateX: 0, opacity: 1, y: 0 }} transition={{ ...spring.bouncy, delay: 0.5 + i * 0.08 }}>
                  {le.display(l)}
                </motion.span>
              ))}
            </div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }} className="learn__value" lang={m.lang} dir={le.dir}>
              {a.c ? <small className="muted">{a.c} · </small> : null}
              {a.m}
              {a.t ? <div lang="ar" dir="rtl" style={{ fontWeight: 600, marginTop: 4 }}>{a.t}</div> : null}
            </motion.div>
          </div>
        )}
        <div className="stack" style={{ marginTop: 14 }}>
          {me && (
            <Button variant="primary" block disabled={rematching} className="duel-cta" onClick={() => void rematch()}>
              {rematching ? s.rematchWait : m.rematchId ? `🔥 ${s.rematch} ✓` : `🔁 ${s.rematch}`}
            </Button>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <Button block onClick={() => void shareResult()}>
              <Icon name="share" /> {lang === 'ar' ? 'مشاركة' : 'Share'}
            </Button>
            <Button
              block
              onClick={() => {
                useDuel.getState().leave();
                useApp.getState().go('menu', { replace: true });
              }}
            >
              {s.leave}
            </Button>
          </div>
          {!me && (
            <Button block onClick={() => useDuel.getState().prepare()}>
              ⚔️ {s.newDuel}
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

