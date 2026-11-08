import { AnimatePresence, motion } from 'motion/react';
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/store';
import type { CustomChallenge } from '../../core/custom/custom-challenge';
import { decodeChallenge } from '../../core/custom/share-code';
import { isFinished } from '../../core/game/game-state';
import { spring } from '../../styles/motion';
import { useAssistant } from './assistant-store';
import { ax, fmt } from './i18n';
import { Burst, NudgeBubble, OrbCore } from './Orb';
// The chat panel (and its cards, builder, voice) loads on demand — warmed while the browser is idle.
const loadPanel = () => import('./Panel');
const Panel = lazy(() => loadPanel().then((m) => ({ default: m.Panel })));
let panelWarm = false;
function warmPanel() {
  if (panelWarm) return;
  panelWarm = true;
  const ric = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  const go = () => void loadPanel().catch(() => (panelWarm = false));
  if (ric) ric(go, { timeout: 6000 });
  else setTimeout(go, 3000);
}

/** Distance from the bottom of the app shell to keep the orb above the in-game keyboard. */
function useKeyboardClearance(): number {
  const screen = useApp((s) => s.screen);
  const status = useApp((s) => s.session?.status);
  const [bottom, setBottom] = useState(18);
  useLayoutEffect(() => {
    const measure = () => {
      const app = document.querySelector('.app');
      const kb = document.querySelector('.app .kb');
      if (!app || !kb || screen !== 'game') return setBottom(18);
      setBottom(Math.max(18, app.getBoundingClientRect().bottom - kb.getBoundingClientRect().top + 10));
    };
    measure();
    const t1 = setTimeout(measure, 120);
    const t2 = setTimeout(measure, 450);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', measure);
    };
  }, [screen, status]);
  return bottom;
}

/** True while any bottom sheet (result, hints, confirmations…) is on screen — the orb steps aside. */
function useSheetOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const app = document.querySelector('.app');
    if (!app) return;
    const check = () => setOpen(!!app.querySelector('.sheet'));
    check();
    const mo = new MutationObserver(check);
    mo.observe(app, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  return open;
}

const seen = new Set<string>();
const once = (id: string) => (seen.has(id) ? false : (seen.add(id), true));
const flag = (k: string) => {
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return true;
  }
};

/** Gentle, rare, contextual nudges + orb reactions to the game. */
function useCompanion() {
  const screen = useApp((s) => s.screen);
  // Narrow, primitive selectors: this hook must NOT re-render on every typed letter.
  const sessionId = useApp((s) => s.session?.id);
  const status = useApp((s) => s.session?.status);
  const rowsUsed = useApp((s) => s.session?.rows.length ?? 0);
  const maxAttempts = useApp((s) => s.session?.maxAttempts ?? 0);
  const hasReveal = useApp((s) => !!s.session?.reveal);
  const finished = useApp((s) => !!s.session && isFinished(s.session));
  const lost = useApp((s) => !!s.session && isFinished(s.session) && !(s.session.rows.at(-1)?.results.every((r) => r === 'correct') ?? false));
  const showResult = useApp((s) => s.showResult);
  const celebrateTick = useApp((s) => s.celebrateTick);
  const uiLang = useApp((s) => s.prefs.uiLang);
  const { showNudge, dismissNudge, react } = useAssistant.getState();
  const nudge = useAssistant((s) => s.nudge);
  const s = ax(uiLang);

  // celebrate wins, sympathise with losses
  const lastCelebrate = useRef(celebrateTick);
  useEffect(() => {
    if (celebrateTick !== lastCelebrate.current) {
      lastCelebrate.current = celebrateTick;
      react('celebrate');
    }
  }, [celebrateTick, react]);
  useEffect(() => {
    if (lost && sessionId && once(`sad-${sessionId}`)) react('sad');
  }, [lost, sessionId, react]);

  // first-time discovery on the menu
  useEffect(() => {
    if (screen !== 'menu' || flag('wordly.ai.seen')) return;
    const id = setTimeout(() => once('menu') && showNudge({ id: 'menu', text: s.nudgeMenu }), 2600);
    return () => clearTimeout(id);
  }, [screen, s.nudgeMenu, showNudge]);

  // stuck mid-round (two attempts left)
  useEffect(() => {
    if (screen !== 'game' || !sessionId || status !== 'PLAYING') return;
    if (rowsUsed >= 2 && maxAttempts - rowsUsed === 2 && once(`stuck-${sessionId}`)) {
      const id = setTimeout(() => showNudge({ id: `stuck-${sessionId}`, text: s.nudgeStuck }), 2400);
      return () => clearTimeout(id);
    }
  }, [screen, rowsUsed, maxAttempts, sessionId, status, s.nudgeStuck, showNudge]);

  // after the round, once the result sheet is closed
  useEffect(() => {
    if (screen !== 'game' || !sessionId || !finished || showResult || !hasReveal) return;
    if (!once(`done-${sessionId}`)) return;
    const id = setTimeout(
      () => showNudge({ id: `done-${sessionId}`, text: s.nudgeDone, prompt: uiLang === 'ar' ? 'اختبرني في هذه الكلمة' : 'Quiz me on this word', display: uiLang === 'ar' ? '🧩 اختبرني' : '🧩 Quiz me' }),
      900,
    );
    return () => clearTimeout(id);
  }, [screen, sessionId, finished, hasReveal, showResult, s.nudgeDone, uiLang, showNudge]);

  // nudges never linger, and never follow you to another screen
  useEffect(() => {
    if (!nudge) return;
    const id = setTimeout(dismissNudge, 7000);
    return () => clearTimeout(id);
  }, [nudge, dismissNudge]);
  useEffect(() => {
    dismissNudge();
  }, [screen, dismissNudge]);
}

/** Opens `?c=` friend-challenge links once the app has left the splash screen. */
function useFriendLink() {
  const screen = useApp((s) => s.screen);
  const pending = useRef<CustomChallenge | null>(null);
  useEffect(() => {
    try {
      const url = new URL(location.href);
      const code = url.searchParams.get('c');
      if (!code) return;
      pending.current = decodeChallenge(code);
      url.searchParams.delete('c');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch {
      /* ignore malformed links */
    }
  }, []);
  useEffect(() => {
    if (screen !== 'menu' || !pending.current) return;
    const ch = pending.current;
    pending.current = null;
    void useApp
      .getState()
      .startCustom(ch)
      .then((ok) => ok && useApp.getState().showToast(ax(useApp.getState().prefs.uiLang).friendChallenge, 'success'));
  }, [screen]);
}

/** A full-screen wave of tiles that carries the player from the chat into the new board. */
function LaunchOverlay({ ch, onCovered, onDone }: { ch: CustomChallenge; onCovered(): void; onDone(): void }) {
  const uiLang = useApp((s) => s.prefs.uiLang);
  const s = ax(uiLang);
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  const cols = 6;
  const rows = 12;
  const colors = useMemo(() => Array.from({ length: cols * rows }, (_, i) => ['var(--correct)', 'var(--present)', 'var(--absent)', 'var(--correct)', 'var(--surface-2)'][(i * 7 + (i % 5)) % 5]), []);
  useEffect(() => {
    const t1 = setTimeout(() => {
      onCovered();
      setPhase('out');
    }, 720);
    const t2 = setTimeout(onDone, 1500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ai-launch" aria-hidden>
      <div className="ai-launch__grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
        {colors.map((c, i) => {
          const d = ((i % cols) + Math.floor(i / cols)) * 0.022;
          return (
            <motion.span
              key={i}
              style={{ background: c }}
              initial={{ rotateX: -90, opacity: 0 }}
              animate={phase === 'in' ? { rotateX: 0, opacity: 1 } : { rotateX: 90, opacity: 0 }}
              transition={{ duration: 0.34, delay: phase === 'in' ? d : 0.12 + d * 0.8, ease: [0.45, 0, 0.25, 1] }}
            />
          );
        })}
      </div>
      <motion.div className="ai-launch__label" initial={{ opacity: 0, scale: 0.7 }} animate={phase === 'in' ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.2 }} transition={{ ...spring.bouncy, delay: phase === 'in' ? 0.25 : 0 }}>
        <b dir="ltr">
          {ch.length} × {ch.attempts}
        </b>
        <span>{ch.topic || s.cReady}</span>
      </motion.div>
    </div>
  );
}

/**
 * The AI entry point: a small liquid-glass orb resting bottom-right. It stays out of the way
 * (above the keyboard during play), reacts to the game, and morphs into the chat panel.
 */
export function Assistant() {
  const open = useAssistant((s) => s.open);
  const phase = useAssistant((s) => s.phase);
  const mood = useAssistant((s) => s.mood);
  const moodTick = useAssistant((s) => s.moodTick);
  const nudge = useAssistant((s) => s.nudge);
  const openPanel = useAssistant((s) => s.openPanel);
  const messages = useAssistant((s) => s.messages);
  const uiLang = useApp((s) => s.prefs.uiLang);
  const screen = useApp((s) => s.screen);
  const bottom = useKeyboardClearance();
  const sheetOpen = useSheetOpen();
  const [launch, setLaunch] = useState<CustomChallenge | null>(null);
  const [unread, setUnread] = useState(false);
  const s = ax(uiLang);
  useCompanion();
  useEffect(warmPanel, []);
  const gameMode = useApp((st) => st.session?.mode);
  useFriendLink();

  // a reply that lands while the panel is closed shows a badge on the orb
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (prevPhase.current !== 'idle' && phase === 'idle' && !useAssistant.getState().open) setUnread(true);
    prevPhase.current = phase;
  }, [phase]);
  useEffect(() => {
    if (open) setUnread(false);
    // the screen behind the panel is covered: pause its decorative animations
    if (open) document.documentElement.dataset.aiOpen = '1';
    else delete document.documentElement.dataset.aiOpen;
  }, [open]);

  // hidden where it would get in the way: timed speed runs and the guided tutorial
  if (screen === 'splash' || screen === 'duel' || screen === 'account' || (screen === 'game' && (gameMode === 'speed' || gameMode === 'tutorial'))) return null;
  const compact = screen === 'game' && bottom > 18;
  const size = compact ? 42 : 54;
  const last = messages.at(-1);

  const startLaunch = (ch: CustomChallenge) => {
    if (document.documentElement.dataset.motion === 'reduced') {
      void useApp
        .getState()
        .startCustom(ch)
        .then((ok) => ok && useAssistant.getState().close());
      return;
    }
    setLaunch(ch);
  };

  return (
    <>
      <AnimatePresence>
        {open && <motion.div key="ai-scrim" className="ai-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => useAssistant.getState().close()} />}
      </AnimatePresence>
      {!open && !sheetOpen && <NudgeBubble bottom={bottom} compact={compact} />}
      <AnimatePresence initial={false}>
        {open ? (
          <Suspense key="panel" fallback={null}>
            <Panel onLaunch={startLaunch} />
          </Suspense>
        ) : sheetOpen ? null : (
          <motion.button
            key="orb"
            type="button"
            className={`ai-orb${compact ? ' ai-orb--compact' : ''}${nudge ? ' has-nudge' : ''}`}
            aria-label={s.open}
            title={s.title}
            style={{ bottom, borderRadius: 999, width: size, height: size }}
            onClick={() => openPanel()}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.88 }}
            transition={spring.sheet}
          >
            <OrbCore size={size} />
            {mood === 'celebrate' && <Burst tick={moodTick} />}
            <AnimatePresence>
              {(unread || nudge) && <motion.span key="badge" className={`ai-orb__badge${unread ? ' is-unread' : ''}`} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring.bouncy} />}
            </AnimatePresence>
            {phase !== 'idle' && <span className="ai-orb__ring" />}
            {unread && last?.challenge && <span className="sr-only">{fmt(s.cLetters, { n: last.challenge.length })}</span>}
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {launch && (
          <LaunchOverlay
            key="launch"
            ch={launch}
            onCovered={() => {
              useAssistant.getState().close();
              void useApp.getState().startCustom(launch);
            }}
            onDone={() => setLaunch(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
