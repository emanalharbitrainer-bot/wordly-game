import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../../app/store';
import type { CustomChallenge } from '../../core/custom/custom-challenge';
import { spring } from '../../styles/motion';
import { buildGameContext, dockActions, haptic, suggestionContext, useAssistant, type ChatMessage } from './assistant-store';
import { Builder } from './Builder';
import { Candidates, ChallengeCard, QuizCard, RichText, Thinking, useSmoothText } from './Cards';
import { ax } from './i18n';
import { OrbCore } from './Orb';
import { useVoice } from './useVoice';

function Bubble({ m, last, onLaunch }: { m: ChatMessage; last: boolean; onLaunch(ch: CustomChallenge): void }) {
  const uiLang = useApp((s) => s.prefs.uiLang);
  const phase = useAssistant((s) => s.phase);
  const intent = useAssistant((s) => s.intent);
  const status = useAssistant((s) => s.status);
  const send = useAssistant((s) => s.send);
  const retry = useAssistant((s) => s.retry);
  const text = useSmoothText(m.text, !!m.streaming);
  const s = ax(uiLang);
  const typing = m.streaming && (text.length < m.text.length || phase === 'streaming');

  if (m.role === 'user') {
    return (
      <motion.div className={`ai-msg ai-msg--user${m.kind === 'builder' ? ' ai-msg--builder' : ''}`} initial={{ opacity: 0, y: 12, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring.snappy} dir="auto">
        {m.text}
      </motion.div>
    );
  }
  const waiting = m.streaming && !m.text;
  return (
    <motion.div className="ai-row" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
      <div className={`ai-msg ai-msg--assistant${m.error ? ' ai-msg--error' : ''}${typing ? ' is-typing' : ''}`} dir="auto">
        {waiting ? <Thinking intent={intent} status={status} lang={uiLang} /> : <RichText text={text} />}
        {m.streaming && status === 'validating' && text && <Thinking intent="build" status={status} lang={uiLang} />}
        {m.error && (
          <button type="button" className="ai-chip ai-chip--retry" onClick={retry}>
            ↻ {s.retry}
          </button>
        )}
      </div>
      {!m.streaming && m.challenge && <ChallengeCard ch={m.challenge} onLaunch={onLaunch} />}
      {!m.streaming && m.quiz && <QuizCard quiz={m.quiz} />}
      {!m.streaming && m.candidates && m.candidates.length > 0 && <Candidates list={m.candidates} />}
      {last && !m.streaming && m.suggestions && m.suggestions.length > 0 && (
        <div className="ai-followups">
          {m.suggestions.map((q, i) => (
            <motion.button key={q} type="button" className="ai-chip" disabled={phase !== 'idle'} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay: 0.15 + i * 0.06 }} whileTap={{ scale: 0.94 }} onClick={() => void send(q)}>
              {q}
            </motion.button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function Welcome() {
  const uiLang = useApp((s) => s.prefs.uiLang);
  const s = ax(uiLang);
  const setTab = useAssistant((st) => st.setTab);
  const send = useAssistant((st) => st.send);
  const A = uiLang === 'ar';
  const caps: { icon: string; title: string; run(): void }[] = [
    { icon: '🎯', title: A ? 'تحديات مخصصة' : 'Custom challenges', run: () => setTab('build') },
    { icon: '💡', title: A ? 'تلميحات ذكية' : 'Smart hints', run: () => void send(A ? 'كيف تشتغل تلميحاتك؟' : 'How do your hints work?') },
    { icon: '🧠', title: A ? 'تحليل المحاولات' : 'Guess analysis', run: () => void send(A ? 'وش أفضل استراتيجية للعب؟' : 'What is the best strategy?') },
    { icon: '🧩', title: A ? 'اختبارات ممتعة' : 'Fun quizzes', run: () => void send(A ? 'اختبرني في كلمة عربية جميلة' : 'Quiz me on a beautiful English word') },
  ];
  const title = s.greetingTitle;
  return (
    <motion.div className="ai-welcome" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="ai-welcome__orb">
        <OrbCore size={64} />
      </div>
      <motion.h3 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        {title}
      </motion.h3>
      <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
        {s.greetingBody}
      </motion.p>
      <div className="ai-caps">
        {caps.map((c, i) => (
          <motion.button key={c.title} type="button" className="ai-cap" initial={{ opacity: 0, y: 14, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...spring.soft, delay: 0.22 + i * 0.07 }} whileHover={{ y: -2 }} whileTap={{ scale: 0.95 }} onClick={c.run}>
            <span className="ai-cap__icon">{c.icon}</span>
            <span>{c.title}</span>
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}

function Composer() {
  const uiLang = useApp((s) => s.prefs.uiLang);
  const s = ax(uiLang);
  const phase = useAssistant((st) => st.phase);
  const send = useAssistant((st) => st.send);
  const stop = useAssistant((st) => st.stop);
  const [draft, setDraft] = useState('');
  const ta = useRef<HTMLTextAreaElement>(null);
  const voice = useVoice(uiLang, (t, final) => {
    setDraft(t);
    if (final && t.trim()) {
      void send(t);
      setDraft('');
    }
  });
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(110, el.scrollHeight)}px`;
  }, [draft]);
  const busy = phase !== 'idle';
  const submit = () => {
    const t = draft.trim();
    if (!t || busy) return;
    setDraft('');
    void send(t);
  };
  return (
    <form
      className={`ai-composer${voice.listening ? ' is-listening' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {voice.supported && (
        <motion.button type="button" className={`ai-mic${voice.listening ? ' is-on' : ''}`} aria-label={s.mic} whileTap={{ scale: 0.9 }} onClick={() => (voice.listening ? voice.stop() : (haptic(6), voice.start()))}>
          {voice.listening ? (
            <span className="ai-wave" aria-hidden>
              <i />
              <i />
              <i />
              <i />
            </span>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden>
              <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
              <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </motion.button>
      )}
      <textarea
        ref={ta}
        value={draft}
        rows={1}
        maxLength={600}
        dir="auto"
        placeholder={voice.listening ? s.listening : s.placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <AnimatePresence mode="popLayout" initial={false}>
        {busy ? (
          <motion.button key="stop" type="button" className="ai-send ai-send--stop" aria-label={s.stop} initial={{ scale: 0.4, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0.4, rotate: 90 }} transition={spring.snappy} onClick={stop}>
            <span className="ai-send__square" />
          </motion.button>
        ) : (
          <motion.button key="send" type="submit" className="ai-send" aria-label={s.send} disabled={!draft.trim()} initial={{ scale: 0.4, rotate: 90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0.4, rotate: -90 }} transition={spring.snappy} whileTap={{ scale: 0.88 }}>
            <svg viewBox="0 0 24 24" aria-hidden className={uiLang === 'ar' ? 'flip-rtl' : undefined}>
              <path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>
    </form>
  );
}

function Dock() {
  const uiLang = useApp((s) => s.prefs.uiLang);
  useApp((s) => s.session?.rows.length); // re-render as the round evolves
  useApp((s) => s.session?.status);
  const phase = useAssistant((st) => st.phase);
  const send = useAssistant((st) => st.send);
  const ctx = suggestionContext(buildGameContext());
  const actions = dockActions(ctx, uiLang);
  return (
    <div className="ai-dock">
      {actions.map((a, i) => (
        <motion.button
          key={`${ctx}-${a.label}`}
          type="button"
          className={`ai-dock__btn tone-${a.tone ?? 'plain'}`}
          disabled={phase !== 'idle'}
          initial={{ opacity: 0, y: 10, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...spring.soft, delay: 0.04 * i }}
          whileTap={{ scale: 0.92 }}
          onClick={() => void send(`${a.icon} ${a.label}`, { prompt: a.prompt, intent: a.intent, kind: 'action' })}
        >
          <span className="ai-dock__icon">{a.icon}</span>
          {a.label}
        </motion.button>
      ))}
    </div>
  );
}

export function Panel({ onLaunch }: { onLaunch(ch: CustomChallenge): void }) {
  const uiLang = useApp((s) => s.prefs.uiLang);
  const s = ax(uiLang);
  const { messages, phase, tab, close, reset, setTab } = useAssistant();
  const listRef = useRef<HTMLDivElement>(null);
  const drag = useDragControls();
  // Mount the heavy body one frame after the shell, so the open animation starts immediately
  // instead of waiting for the whole chat to render and lay out inside the tap.
  const [ready, setReady] = useState(false);
  const firstScroll = useRef(true);
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: firstScroll.current ? 'auto' : 'smooth' });
    firstScroll.current = false;
  }, [messages.length, messages.at(-1)?.text.length, messages.at(-1)?.streaming, tab, ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const subtitle = phase === 'thinking' ? s.subtitleThinking : phase === 'streaming' ? s.subtitleStreaming : s.subtitleIdle;

  return (
    <motion.section
      className="ai-panel"
      role="dialog"
      aria-label={s.title}
      style={{ borderRadius: 30, transformOrigin: '92% 100%' }}
      initial={{ opacity: 0, scale: 0.4, y: 30 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.5, y: 24, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
      transition={spring.sheet}
      drag="y"
      dragControls={drag}
      dragListener={false}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.05, bottom: 0.7 }}
      onDragEnd={(_, info) => {
        if (info.offset.y > 110 || info.velocity.y > 700) close();
      }}
    >
      <div className="ai-panel__aurora" aria-hidden />
      <motion.div className="ai-panel__inner" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.1 } }} exit={{ opacity: 0, transition: { duration: 0.08 } }}>
        <header className="ai-head" onPointerDown={(e) => drag.start(e)}>
          <span className="ai-head__grip" />
          <div className="ai-head__row">
            <OrbCore size={36} />
            <div className="ai-head__titles">
              <strong>{s.title}</strong>
              <AnimatePresence mode="wait">
                <motion.span key={subtitle} className={`ai-head__sub${phase !== 'idle' ? ' is-live' : ''}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
                  <i />
                  {subtitle}
                </motion.span>
              </AnimatePresence>
            </div>
            {messages.length > 0 && (
              <motion.button type="button" className="ai-iconbtn" aria-label={s.newChat} title={s.newChat} whileTap={{ scale: 0.88, rotate: -90 }} onPointerDown={(e) => e.stopPropagation()} onClick={reset}>
                ↺
              </motion.button>
            )}
            <motion.button type="button" className="ai-iconbtn" aria-label={s.close} whileTap={{ scale: 0.88 }} onPointerDown={(e) => e.stopPropagation()} onClick={close}>
              ✕
            </motion.button>
          </div>
          <div className="ai-tabs seg-slider" data-on={tab === 'build' ? 1 : 0} role="tablist" onPointerDown={(e) => e.stopPropagation()}>
            {(['chat', 'build'] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'is-on' : ''} onClick={() => (haptic(5), setTab(t))}>
                <span>{t === 'chat' ? `💬 ${s.tabChat}` : `🎯 ${s.tabBuild}`}</span>
              </button>
            ))}
          </div>
        </header>

        <AnimatePresence mode="wait" initial={false}>
          {!ready ? (
            <div key="shell" className="ai-chat" />
          ) : tab === 'build' ? (
            <Builder key="build" />
          ) : (
            <motion.div key="chat" className="ai-chat" initial={{ opacity: 0, x: uiLang === 'ar' ? 24 : -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: uiLang === 'ar' ? -24 : 24 }} transition={spring.soft}>
              <div className="ai-list" ref={listRef}>
                {messages.length === 0 && <Welcome />}
                {messages.map((m, i) => (
                  <Bubble key={m.id} m={m} last={i === messages.length - 1} onLaunch={onLaunch} />
                ))}
              </div>
              <Dock />
              <Composer />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.section>
  );
}
