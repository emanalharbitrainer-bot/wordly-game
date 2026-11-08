import { AnimatePresence, motion } from 'motion/react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../../app/store';
import type { CustomChallenge } from '../../core/custom/custom-challenge';
import { challengeLink } from '../../core/custom/share-code';
import { BACKSPACE } from '../../core/keyboard/keyboard-layouts';
import { getLanguageEngine } from '../../core/localization/localization-engine';
import { wordEngine } from '../../core/words/word-engine';
import type { AiQuiz } from '../../services/ai/ai-client';
import { spring } from '../../styles/motion';
import type { Lang } from '../../types';
import { shareText } from '../../utils/share';
import { haptic, useAssistant, type Intent } from './assistant-store';
import { ax, fmt } from './i18n';

const PALETTE = ['var(--correct)', 'var(--present)', 'var(--correct)', 'var(--absent)'];
const isArabic = (s: string) => /[؀-ۿ]/.test(s);

/* ───────────── text ───────────── */

/** Reveals streamed text smoothly (frame-paced) instead of in network-sized bursts. */
export function useSmoothText(text: string, active: boolean): string {
  const [shown, setShown] = useState(active ? 0 : text.length);
  const target = useRef(text);
  target.current = text;
  useEffect(() => {
    if (!active && shown >= text.length) return;
    let raf = 0;
    const tick = () => {
      setShown((n) => {
        const diff = target.current.length - n;
        if (diff <= 0) return n;
        return n + Math.max(1, Math.ceil(diff / 7));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, shown >= text.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return text.slice(0, Math.min(shown, text.length));
}

/** A word drawn as WORDLY tiles. */
export function TileWord({ word, size = 20, lang, delay = 0 }: { word: string; size?: number; lang?: Lang; delay?: number }) {
  const l: Lang = lang ?? (isArabic(word) ? 'ar' : 'en');
  const le = getLanguageEngine(l);
  const parts = le.toLetters(word);
  return (
    <span className="tileword" dir={le.dir} style={{ ['--ts' as string]: `${size}px` }}>
      {parts.map((ch, i) => (
        <motion.span
          key={i}
          className="tileword__t"
          style={{ background: ch === '■' ? 'var(--absent)' : PALETTE[i % 3 === 2 ? 1 : 0] }}
          initial={{ rotateX: -90, opacity: 0 }}
          animate={{ rotateX: 0, opacity: 1 }}
          transition={{ ...spring.bouncy, delay: delay + i * 0.05 }}
        >
          {ch === '■' ? '' : le.display(ch)}
        </motion.span>
      ))}
    </span>
  );
}

function inline(text: string, keyBase: string): ReactNode[] {
  // **bold** and [[tile words]]
  return text.split(/(\*\*[^*]+\*\*|\[\[[^\]]+\]\])/g).map((p, j) => {
    const key = `${keyBase}-${j}`;
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <b key={key}>{words(p.slice(2, -2), key)}</b>;
    if (p.startsWith('[[') && p.endsWith(']]')) return <TileWord key={key} word={p.slice(2, -2)} />;
    return <Fragment key={key}>{words(p, key)}</Fragment>;
  });
}
function words(text: string, keyBase: string): ReactNode[] {
  return text.split(/(\s+)/).map((w, i) => (/^\s+$/.test(w) || !w ? w : <span key={`${keyBase}-w${i}`} className="ai-w">{w}</span>));
}

/** Minimal, safe rich text: **bold**, [[tile words]], "- " bullets and "1." lists. No HTML injection. */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => {
        if (!line.trim()) return <div key={i} className="ai-gap" />;
        const bullet = /^\s*[-•*]\s+/.test(line);
        const num = /^\s*(\d+)[.)]\s+/.exec(line);
        const body = line.replace(/^\s*[-•*]\s+/, '').replace(/^\s*\d+[.)]\s+/, '');
        return (
          <div key={i} className={bullet ? 'ai-bullet' : num ? 'ai-num' : 'ai-line'} data-n={num?.[1]}>
            {inline(body, String(i))}
          </div>
        );
      })}
    </>
  );
}

/* ───────────── thinking ───────────── */

export function ThinkingTiles({ size = 14, count = 5 }: { size?: number; count?: number }) {
  return (
    <span className="think-tiles" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="think-tiles__t" style={{ width: size, height: size, animationDelay: `${i * 0.12}s` }} />
      ))}
    </span>
  );
}

export function Thinking({ intent, status, lang }: { intent: Intent; status: string | null; lang: Lang }) {
  const s = ax(lang);
  const lines = status === 'validating' ? [s.validating] : intent === 'build' ? s.thinkingBuild : intent === 'hint' ? s.thinkingHint : intent === 'analyse' ? s.thinkingAnalyse : s.thinking;
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => x + 1), 1500);
    return () => clearInterval(id);
  }, []);
  const line = lines[i % lines.length];
  return (
    <div className="ai-thinking">
      <ThinkingTiles />
      <AnimatePresence mode="wait">
        <motion.span key={line} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
          {line}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

/* ───────────── mini board ───────────── */

export function MiniBoard({ rows, cols, max = 250, live = true }: { rows: number; cols: number; max?: number; live?: boolean }) {
  const gap = 4;
  const size = Math.max(10, Math.min(24, Math.floor((max - gap * (cols - 1)) / cols)));
  return (
    <motion.div layout className="miniboard" style={{ gridTemplateColumns: `repeat(${cols}, ${size}px)`, gap }} transition={spring.soft}>
      <AnimatePresence initial={false} mode="popLayout">
        {Array.from({ length: rows * cols }, (_, k) => {
          const r = Math.floor(k / cols);
          const c = k % cols;
          return (
            <motion.span
              key={`${r}-${c}`}
              layout
              className={`miniboard__t${live && r === 0 ? ' miniboard__t--wave' : ''}`}
              style={{ width: size, height: size, animationDelay: `${c * 0.14}s` }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ ...spring.bouncy, delay: Math.min(0.5, (r + c) * 0.025) }}
            />
          );
        })}
      </AnimatePresence>
    </motion.div>
  );
}

/* ───────────── challenge card ───────────── */

export function ChallengeCard({ ch, onLaunch }: { ch: CustomChallenge; onLaunch(ch: CustomChallenge): void }) {
  const uiLang = useApp((s) => s.prefs.uiLang);
  const showToast = useApp((s) => s.showToast);
  const s = ax(uiLang);
  const diffTone = { easy: 'green', normal: 'blue', hard: 'gold', expert: 'fire' }[ch.difficulty] ?? 'blue';
  const share = async () => {
    haptic(6);
    const intro = uiLang === 'ar' ? `🎯 أتحداك في WORDLY! كلمة ${ch.lang === 'ar' ? 'عربية' : 'إنجليزية'} من ${ch.length} حروف و${ch.attempts} محاولات${ch.topic ? ` عن ${ch.topic}` : ''}.` : `🎯 I challenge you on WORDLY! A ${ch.length}-letter ${ch.lang === 'ar' ? 'Arabic' : 'English'} word, ${ch.attempts} tries${ch.topic ? `, topic: ${ch.topic}` : ''}.`;
    const r = await shareText(`${intro}\n${challengeLink(ch)}`);
    if (r === 'copied') showToast(s.cShared, 'success');
  };
  return (
    <motion.div className="ai-card ai-challenge" initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring.soft}>
      <div className="ai-challenge__glow" aria-hidden />
      <div className="ai-challenge__head">
        <span className="ai-spark">✦</span>
        <b>{s.cReady}</b>
        {ch.topic && <span className="ai-tag">{ch.topic}</span>}
      </div>
      <MiniBoard rows={Math.min(ch.attempts, 10)} cols={ch.length} max={232} />
      <div className="ai-challenge__meta">
        <span>{ch.lang === 'ar' ? 'عربي' : 'English'}</span>
        <span>{fmt(s.cLetters, { n: ch.length })}</span>
        <span>{fmt(s.cAttempts, { n: ch.attempts })}</span>
        <span className={`tone-${diffTone}`}>{s.diff[ch.difficulty]}</span>
      </div>
      <div className="ai-challenge__actions">
        <motion.button type="button" className="ai-cta" whileTap={{ scale: 0.96 }} onClick={() => onLaunch(ch)}>
          <span>{s.cStart}</span>
          <span className="ai-cta__arrow" aria-hidden>
            {uiLang === 'ar' ? '←' : '→'}
          </span>
        </motion.button>
        <motion.button type="button" className="ai-ghost" whileTap={{ scale: 0.94 }} onClick={() => void share()} aria-label={s.cShare} title={s.cShare}>
          🔗
        </motion.button>
      </div>
    </motion.div>
  );
}

/* ───────────── quiz ───────────── */

export function QuizCard({ quiz }: { quiz: AiQuiz }) {
  const uiLang = useApp((s) => s.prefs.uiLang);
  const s = ax(uiLang);
  const [picked, setPicked] = useState<number | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const done = picked !== null;
  const right = picked === quiz.answer;
  useEffect(() => {
    if (done) haptic(right ? 14 : [10, 40, 10]);
  }, [done, right]);
  return (
    <motion.div className="ai-card ai-quiz" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
      <div className="ai-quiz__q">
        <span className="ai-quiz__badge">?</span>
        {quiz.question}
      </div>
      <div className="ai-quiz__opts">
        {quiz.options.map((o, i) => {
          const state = !done ? '' : i === quiz.answer ? 'is-right' : i === picked ? 'is-wrong' : 'is-dim';
          return (
            <motion.button
              key={i}
              type="button"
              disabled={done}
              className={`ai-quiz__opt ${state}`}
              initial={{ opacity: 0, x: uiLang === 'ar' ? -12 : 12 }}
              animate={state === 'is-wrong' ? { x: [0, -7, 6, -4, 3, 0], opacity: 1 } : state === 'is-right' ? { rotateX: [0, 90, 0], opacity: 1, x: 0 } : { opacity: 1, x: 0 }}
              transition={state ? { duration: 0.45 } : { delay: 0.08 * i, ...spring.soft }}
              whileTap={done ? undefined : { scale: 0.97 }}
              onClick={() => setPicked(i)}
            >
              <span className="ai-quiz__key">{uiLang === 'ar' ? 'أبجد'[i] : 'ABCD'[i]}</span>
              <span>{o}</span>
            </motion.button>
          );
        })}
      </div>
      <AnimatePresence>
        {done && (
          <motion.div
            className={`ai-quiz__result ${right ? 'is-right' : 'is-wrong'}`}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            transition={spring.soft}
            onAnimationComplete={() => resultRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}
            ref={resultRef}
          >
            <b>{right ? s.quizCorrect : s.quizWrong}</b>
            {quiz.explain && <div>{quiz.explain}</div>}
            <button type="button" className="ai-chip" onClick={() => void useAssistant.getState().send(s.quizNext, { prompt: uiLang === 'ar' ? 'اختبرني بسؤال آخر مختلف' : 'Quiz me with another, different question' })}>
              {s.quizNext}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ───────────── candidate words ───────────── */

/** Types a word into the live board, letter by letter, so the player can just press Enter. */
export async function typeIntoBoard(word: string) {
  const app = useApp.getState();
  const session = app.session;
  if (!session || session.status !== 'PLAYING') return;
  const le = getLanguageEngine(session.lang);
  for (let i = session.current.length; i > 0; i--) app.pressKey(BACKSPACE);
  for (const ch of le.toLetters(word)) {
    await new Promise((r) => setTimeout(r, 85));
    useApp.getState().pressKey(ch);
  }
  haptic(10);
}

export function Candidates({ list }: { list: string[] }) {
  const session = useApp((s) => s.session);
  const uiLang = useApp((s) => s.prefs.uiLang);
  const s = ax(uiLang);
  const [valid, setValid] = useState<Record<string, boolean>>({});
  const lang = session?.lang;
  const length = session?.length;
  const key = list.join('|');
  useEffect(() => {
    if (!lang || !length) return;
    let alive = true;
    void wordEngine
      .load(lang, length)
      .then((d) => alive && setValid(Object.fromEntries(list.map((w) => [w, d.isValidGuess(getLanguageEngine(lang).normalize(w))]))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key, lang, length]); // eslint-disable-line react-hooks/exhaustive-deps
  const playable = useMemo(() => session?.status === 'PLAYING', [session?.status]);
  if (!list.length || !lang) return null;
  return (
    <motion.div className="ai-card ai-cands" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
      <div className="ai-cands__title">{s.candTitle}</div>
      <div className="ai-cands__list">
        {list.map((w, i) => {
          const ok = valid[w] !== false;
          return (
            <motion.button
              key={w}
              type="button"
              className="ai-cand"
              disabled={!ok || !playable}
              title={ok ? undefined : s.candInvalid}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: ok ? 1 : 0.45, scale: 1 }}
              transition={{ ...spring.soft, delay: i * 0.07 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                useAssistant.getState().close();
                setTimeout(() => void typeIntoBoard(w), 260);
              }}
            >
              <TileWord word={w} lang={lang} size={24} delay={i * 0.07} />
              <span className="ai-cand__go" aria-hidden>
                ↵
              </span>
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}
