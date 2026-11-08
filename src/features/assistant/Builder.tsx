import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useApp } from '../../app/store';
import { spring } from '../../styles/motion';
import type { Difficulty, Lang } from '../../types';
import { haptic, useAssistant } from './assistant-store';
import { MiniBoard } from './Cards';
import { ax, fmt } from './i18n';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard', 'expert'];

function Stepper({ label, value, min, max, onChange, unit }: { label: string; value: number; min: number; max: number; onChange(n: number): void; unit: string }) {
  const uiLang = useApp((s) => s.prefs.uiLang);
  const num = (n: number) => (uiLang === 'ar' ? n.toLocaleString('ar-SA') : String(n));
  const step = (d: number) => {
    const n = Math.min(max, Math.max(min, value + d));
    if (n !== value) {
      haptic(5);
      onChange(n);
    }
  };
  return (
    <div className="bld-stepper">
      <div className="bld-label">{label}</div>
      <div className="bld-stepper__row">
        <motion.button type="button" whileTap={{ scale: 0.85 }} disabled={value <= min} onClick={() => step(-1)} aria-label="-">
          −
        </motion.button>
        <div className="bld-stepper__value">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={value} initial={{ y: 14, opacity: 0, scale: 0.7 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -14, opacity: 0, scale: 0.7 }} transition={spring.snappy}>
              {num(value)}
            </motion.span>
          </AnimatePresence>
          <small>{unit}</small>
        </div>
        <motion.button type="button" whileTap={{ scale: 0.85 }} disabled={value >= max} onClick={() => step(1)} aria-label="+">
          +
        </motion.button>
      </div>
    </div>
  );
}

/** Visual challenge builder: every choice reshapes a live mini board, then the AI picks the word. */
export function Builder() {
  const uiLang = useApp((s) => s.prefs.uiLang);
  const puzzleLang = useApp((s) => s.prefs.puzzleLang);
  const s = ax(uiLang);
  const [lang, setLang] = useState<Lang>(puzzleLang ?? uiLang);
  const [length, setLength] = useState(5);
  const [attempts, setAttempts] = useState(6);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [topic, setTopic] = useState(s.topics[0][1]);
  const [custom, setCustom] = useState('');
  const send = useAssistant((st) => st.send);
  const phase = useAssistant((st) => st.phase);

  const create = () => {
    const t = custom.trim() || topic;
    const random = t === s.topics[0][1];
    const langName = lang === 'ar' ? (uiLang === 'ar' ? 'عربي' : 'Arabic') : 'English';
    const display = `🎯 ${langName} · ${fmt(s.cLetters, { n: length })} · ${fmt(s.cAttempts, { n: attempts })} · ${s.diff[difficulty]}${random ? '' : ` · ${t}`}`;
    const prompt = `[builder] Create a custom challenge now with EXACTLY: lang=${lang}, length=${length}, attempts=${attempts}, difficulty=${difficulty}, topic=${random ? 'any surprising topic you choose' : t}.`;
    void send(display, { prompt, intent: 'build', kind: 'builder' });
  };

  return (
    <motion.div className="bld" initial={{ opacity: 0, x: uiLang === 'ar' ? -24 : 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: uiLang === 'ar' ? 24 : -24 }} transition={spring.soft}>
      <div className="bld-scroll">
        <div className="bld-preview">
          <div className="bld-preview__label">
            {s.bPreview} · <b dir="ltr">{length} × {attempts}</b>
          </div>
          <MiniBoard rows={attempts} cols={length} max={210} />
        </div>

        <div className="bld-label">{s.bLang}</div>
        <div className="bld-seg seg-slider" data-on={lang === 'en' ? 1 : 0} role="radiogroup">
          {(['ar', 'en'] as Lang[]).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={lang === l} className={lang === l ? 'is-on' : ''} onClick={() => (haptic(5), setLang(l))}>
              <span>{l === 'ar' ? 'عربي' : 'English'}</span>
            </button>
          ))}
        </div>

        <div className="bld-steppers">
          <Stepper label={s.bLetters} value={length} min={3} max={8} onChange={setLength} unit={uiLang === 'ar' ? 'حروف' : 'letters'} />
          <Stepper label={s.bAttempts} value={attempts} min={3} max={10} onChange={setAttempts} unit={uiLang === 'ar' ? 'محاولات' : 'tries'} />
        </div>

        <div className="bld-label">{s.bDifficulty}</div>
        <div className="bld-diffs">
          {DIFFS.map((d) => (
            <motion.button key={d} type="button" whileTap={{ scale: 0.94 }} className={`bld-diff d-${d}${difficulty === d ? ' is-on' : ''}`} onClick={() => (haptic(5), setDifficulty(d))}>
              {s.diff[d]}
            </motion.button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={difficulty} className="bld-hint" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
            {s.diffDesc[difficulty]}
          </motion.div>
        </AnimatePresence>

        <div className="bld-label">{s.bTopic}</div>
        <div className="bld-topics">
          {s.topics.map(([icon, name], i) => (
            <motion.button
              key={name}
              type="button"
              className={`bld-topic${!custom && topic === name ? ' is-on' : ''}`}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ ...spring.soft, delay: 0.02 * i }}
              whileTap={{ scale: 0.92 }}
              onClick={() => {
                haptic(5);
                setTopic(name);
                setCustom('');
              }}
            >
              <span>{icon}</span> {name}
            </motion.button>
          ))}
        </div>
        <input className="bld-input" value={custom} maxLength={40} dir="auto" placeholder={`✍️ ${s.bTopicOther}`} onChange={(e) => setCustom(e.target.value)} />
      </div>
      <div className="bld-footer">
        <motion.button type="button" className="ai-cta ai-cta--big" disabled={phase !== 'idle'} whileTap={{ scale: 0.97 }} onClick={create}>
          <span className="ai-spark">✦</span> {s.bCreate}
        </motion.button>
      </div>
    </motion.div>
  );
}
