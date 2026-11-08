import type { CustomChallenge } from '../../core/custom/custom-challenge';
import type { Lang } from '../../types';

/**
 * Client for the `wordly-ai` Supabase Edge Function. The Anthropic key stays on the server
 * (Supabase Vault); the browser only ever talks to our own function.
 * Answers stream in over Server-Sent Events: text deltas first, then one `meta` event with
 * structured extras (challenge, quiz, candidate words, follow-up suggestions).
 */
const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export interface AiGameContext {
  mode: string;
  lang: Lang;
  length: number;
  maxAttempts: number;
  difficulty: string;
  status: 'PLAYING' | 'WON' | 'LOST';
  rows: { guess: string; pattern: string }[];
  word?: string;
  meaning?: string;
  category?: string;
  knowledge?: { fixed: [number, string][]; present: { letter: string; notAt: number[] }[]; absent: string[] };
}

export interface AiRequest {
  uiLang: Lang;
  screen: string;
  playerId: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  game: AiGameContext | null;
  player?: AiPlayerContext | null;
}

export interface AiPlayerContext {
  name?: string;
  level: number;
  title: string;
  xp: number;
  streak: number;
  streakColor?: string;
  best: number;
  duels: { w: number; l: number; d: number };
  words: { w: string; lang: Lang; m: string; won: boolean }[];
}

export interface AiQuiz {
  question: string;
  options: string[];
  answer: number;
  explain: string;
}

export interface AiMeta {
  challenge: CustomChallenge | null;
  quiz: AiQuiz | null;
  candidates: string[];
  suggestions: string[];
  limited?: boolean;
}

export interface StreamHandlers {
  onDelta(text: string): void;
  onStatus?(status: string): void;
  onMeta(meta: AiMeta): void;
}

const EMPTY_META: AiMeta = { challenge: null, quiz: null, candidates: [], suggestions: [] };

function toMeta(o: Partial<AiMeta> | undefined): AiMeta {
  return {
    challenge: o?.challenge ?? null,
    quiz: o?.quiz ?? null,
    candidates: Array.isArray(o?.candidates) ? o!.candidates : [],
    suggestions: Array.isArray(o?.suggestions) ? o!.suggestions : [],
    limited: o?.limited,
  };
}

export async function streamAssistant(req: AiRequest, h: StreamHandlers, signal?: AbortSignal): Promise<void> {
  if (!URL) throw new Error('AI is not configured');
  const res = await fetch(`${URL}/functions/v1/wordly-ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(KEY ? { apikey: KEY } : {}) },
    body: JSON.stringify({ ...req, stream: true }),
    signal,
  });
  if (!res.ok) throw new Error(`assistant ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('event-stream') || !res.body) {
    // non-streaming fallback
    const data = (await res.json()) as Partial<AiMeta> & { reply?: string };
    h.onDelta(String(data.reply ?? ''));
    h.onMeta(toMeta(data));
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let gotMeta = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      const payload = JSON.parse(data);
      if (event === 'delta') h.onDelta(String(payload.t ?? ''));
      else if (event === 'status') h.onStatus?.(String(payload.s ?? ''));
      else if (event === 'meta') {
        gotMeta = true;
        h.onMeta(toMeta(payload));
      } else if (event === 'error') throw new Error(String(payload.error ?? 'assistant error'));
    }
  }
  if (!gotMeta) h.onMeta(EMPTY_META);
}
