import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lang } from '../../types';

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
type Ctor = new () => Recognition;

/** Speech-to-text through the browser's Web Speech API (feature-detected; hidden when absent). */
export function useVoice(lang: Lang, onText: (text: string, final: boolean) => void) {
  const Impl = (typeof window !== 'undefined' && ((window as unknown as { SpeechRecognition?: Ctor }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: Ctor }).webkitSpeechRecognition)) || null;
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onText);
  cb.current = onText;

  const stop = useCallback(() => {
    rec.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (!Impl) return;
    try {
      const r = new Impl();
      r.lang = lang === 'ar' ? 'ar-SA' : 'en-US';
      r.interimResults = true;
      r.continuous = false;
      r.onresult = (e) => {
        let text = '';
        let final = false;
        for (let i = 0; i < e.results.length; i++) {
          text += e.results[i][0].transcript;
          final = e.results[i].isFinal;
        }
        cb.current(text, final);
      };
      r.onend = () => setListening(false);
      r.onerror = () => setListening(false);
      rec.current = r;
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [Impl, lang]);

  useEffect(() => () => rec.current?.abort(), []);
  return { supported: !!Impl, listening, start, stop };
}
