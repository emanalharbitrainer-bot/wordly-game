import { create } from 'zustand';
import { aiPlayerContext } from '../profile/profile-store';
import { getPlayerId, useApp } from '../../app/store';
import type { CustomChallenge } from '../../core/custom/custom-challenge';
import { deriveKnowledge } from '../../core/difficulty/difficulty-engine';
import { isFinished } from '../../core/game/game-state';
import { streamAssistant, type AiGameContext, type AiQuiz } from '../../services/ai/ai-client';
import type { Lang } from '../../types';
import { ax } from './i18n';

export type Intent = 'chat' | 'build' | 'hint' | 'analyse';
export type Phase = 'idle' | 'thinking' | 'streaming';
export type Mood = 'idle' | 'celebrate' | 'sad' | 'alert';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  /** what the player sees */
  text: string;
  /** what the model receives (defaults to text) */
  prompt?: string;
  kind?: 'builder' | 'action';
  streaming?: boolean;
  error?: boolean;
  challenge?: CustomChallenge | null;
  quiz?: AiQuiz | null;
  candidates?: string[];
  suggestions?: string[];
}

export interface Nudge {
  id: string;
  text: string;
  prompt?: string;
  display?: string;
  intent?: Intent;
}

interface AssistantState {
  open: boolean;
  tab: 'chat' | 'build';
  phase: Phase;
  status: string | null;
  intent: Intent;
  messages: ChatMessage[];
  mood: Mood;
  moodTick: number;
  nudge: Nudge | null;
  openPanel(prompt?: string, opts?: { display?: string; intent?: Intent; kind?: ChatMessage['kind'] }): void;
  close(): void;
  setTab(tab: 'chat' | 'build'): void;
  reset(): void;
  stop(): void;
  retry(): void;
  send(display: string, opts?: { prompt?: string; intent?: Intent; kind?: ChatMessage['kind'] }): Promise<void>;
  react(mood: Mood): void;
  showNudge(n: Nudge): void;
  dismissNudge(): void;
}

const STORE_KEY = 'wordly.ai.chat.v2';
let seq = Date.now();
let inflight: AbortController | null = null;

function loadChat(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const list = raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    return Array.isArray(list) ? list.filter((m) => m && typeof m.text === 'string' && !m.streaming).slice(-30) : [];
  } catch {
    return [];
  }
}
function saveChat(list: ChatMessage[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list.filter((m) => !m.streaming).slice(-30)));
  } catch {
    /* storage unavailable — chat simply isn't remembered */
  }
}

export const haptic = (ms: number | number[] = 8) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
};

/** Snapshot of the round the player is looking at — enough for hints, analysis and tutoring. */
export function buildGameContext(): AiGameContext | null {
  const { session, screen } = useApp.getState();
  if (!session || screen !== 'game') return null;
  const done = isFinished(session);
  const won = session.rows.at(-1)?.results.every((r) => r === 'correct') ?? false;
  // The daily secret is server-only: the assistant only learns it once the round is over.
  const entry = session.mode === 'daily' ? (done ? session.reveal : undefined) : (session.secret ?? session.reveal);
  const k = deriveKnowledge(session.rows);
  return {
    mode: session.mode,
    lang: session.lang,
    length: session.length,
    maxAttempts: session.maxAttempts,
    difficulty: session.difficulty,
    status: done ? (won ? 'WON' : 'LOST') : 'PLAYING',
    rows: session.rows.map((r) => ({ guess: r.letters.join(''), pattern: r.results.map((x) => (x === 'correct' ? 'C' : x === 'present' ? 'P' : 'A')).join('') })),
    word: entry?.w,
    meaning: entry?.m,
    category: entry?.c,
    knowledge: {
      fixed: [...k.fixed].map(([p, l]) => [p + 1, l] as [number, string]),
      present: [...k.forbidden].map(([letter, at]) => ({ letter, notAt: [...at].map((x) => x + 1) })),
      absent: [...k.maxCount].filter(([, m]) => m === 0).map(([l]) => l),
    },
  };
}

export type SuggestionContext = 'idle' | 'playing' | 'playing-daily' | 'finished';

export function suggestionContext(game: AiGameContext | null): SuggestionContext {
  if (!game) return 'idle';
  if (game.status !== 'PLAYING') return game.word ? 'finished' : 'idle';
  return game.mode === 'daily' ? 'playing-daily' : 'playing';
}

export interface DockAction {
  icon: string;
  label: string;
  prompt: string;
  intent: Intent;
  tone?: 'green' | 'gold' | 'fire' | 'violet';
}

/** Context-aware one-tap actions so players discover what the assistant can do. */
export function dockActions(ctx: SuggestionContext, lang: Lang): DockAction[] {
  const s = ax(lang);
  const A = lang === 'ar';
  switch (ctx) {
    case 'playing':
      return [
        { icon: '💡', label: s.hint1, prompt: `[hint:1] ${A ? 'أعطني تلميحاً خفيفاً' : 'Give me a gentle hint'}`, intent: 'hint', tone: 'green' },
        { icon: '🔍', label: s.hint2, prompt: `[hint:2] ${A ? 'أعطني تلميحاً أقوى' : 'Give me a stronger hint'}`, intent: 'hint', tone: 'gold' },
        { icon: '🔥', label: s.hint3, prompt: `[hint:3] ${A ? 'أعطني تلميحاً نارياً' : 'Give me a fire hint'}`, intent: 'hint', tone: 'fire' },
        { icon: '🧠', label: s.analyse, prompt: `[analyse] ${A ? 'حلّل محاولاتي واقترح كلمات' : 'Analyse my guesses and suggest words'}`, intent: 'analyse', tone: 'violet' },
      ];
    case 'playing-daily':
      return [
        { icon: '🧠', label: s.analyse, prompt: `[analyse] ${A ? 'حلّل محاولاتي واقترح كلمات' : 'Analyse my guesses and suggest words'}`, intent: 'analyse', tone: 'violet' },
        { icon: '🎯', label: s.opener, prompt: A ? 'اقترح كلمة بداية قوية لهذا التحدي' : 'Suggest a strong opening word', intent: 'analyse', tone: 'green' },
        { icon: '❓', label: s.howTo, prompt: A ? 'ما معنى الألوان؟ باختصار' : 'What do the colors mean? Briefly', intent: 'chat' },
      ];
    case 'finished':
      return [
        { icon: '🧩', label: s.quizMe, prompt: A ? 'اختبرني في هذه الكلمة' : 'Quiz me on this word', intent: 'chat', tone: 'violet' },
        { icon: '📝', label: s.sentence, prompt: A ? 'ضع الكلمة في جملتين' : 'Use the word in two sentences', intent: 'chat', tone: 'green' },
        { icon: '🔁', label: s.synonyms, prompt: A ? 'أعطني مرادفات وأضداد' : 'Give me synonyms and antonyms', intent: 'chat', tone: 'gold' },
        { icon: '🔊', label: s.pronounce, prompt: A ? 'كيف أنطقها؟ وما جذرها أو أصلها؟' : 'How do I pronounce it and where does it come from?', intent: 'chat' },
        { icon: '🎲', label: s.similar, prompt: A ? 'أنشئ تحدياً مشابهاً بنفس الطول والموضوع' : 'Make a similar challenge with the same length and topic', intent: 'build', tone: 'fire' },
      ];
    default:
      return [
        { icon: '🎯', label: A ? 'تحدٍ من ٦ حروف' : '6-letter challenge', prompt: A ? 'أنشئ لي تحدياً عربياً من ٦ حروف و٥ محاولات' : 'Make me a 6-letter English challenge with 5 tries', intent: 'build', tone: 'green' },
        { icon: '🐾', label: A ? 'حيوانات بالإنجليزي' : 'Arabic animals', prompt: A ? 'تحدٍ إنجليزي عن الحيوانات من ٤ حروف' : 'An Arabic challenge about animals, 4 letters', intent: 'build', tone: 'gold' },
        { icon: '🔥', label: A ? 'خبير ٧ حروف' : 'Expert 7 letters', prompt: A ? 'كلمة صعبة من ٧ حروف بمستوى خبير' : 'A hard 7-letter word on Expert', intent: 'build', tone: 'fire' },
        { icon: '❓', label: ax(lang).howTo, prompt: A ? 'كيف ألعب؟ اشرح لي باختصار' : 'How do I play? Keep it short', intent: 'chat' },
      ];
  }
}

export const useAssistant = create<AssistantState>((set, get) => ({
  open: false,
  tab: 'chat',
  phase: 'idle',
  status: null,
  intent: 'chat',
  messages: loadChat(),
  mood: 'idle',
  moodTick: 0,
  nudge: null,

  openPanel: (prompt, opts) => {
    haptic(6);
    try {
      localStorage.setItem('wordly.ai.seen', '1');
    } catch {
      /* ignore */
    }
    set({ open: true, nudge: null, tab: 'chat' });
    if (prompt) void get().send(opts?.display ?? prompt.replace(/^\[[^\]]+\]\s*/, ''), { prompt, intent: opts?.intent, kind: opts?.kind });
  },

  close: () => set({ open: false }),
  setTab: (tab) => set({ tab }),

  reset: () => {
    inflight?.abort();
    inflight = null;
    set({ messages: [], phase: 'idle', status: null, tab: 'chat' });
    saveChat([]);
  },

  stop: () => {
    inflight?.abort();
    inflight = null;
    const messages = get().messages.map((m) => (m.streaming ? { ...m, streaming: false } : m));
    set({ phase: 'idle', status: null, messages });
    saveChat(messages);
  },

  retry: () => {
    const msgs = get().messages;
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const cut = msgs.slice(0, msgs.lastIndexOf(lastUser));
    set({ messages: cut });
    void get().send(lastUser.text, { prompt: lastUser.prompt, kind: lastUser.kind });
  },

  send: async (display, opts = {}) => {
    const text = display.trim().slice(0, 600);
    if (!text || get().phase !== 'idle') return;
    haptic(8);
    const app = useApp.getState();
    const intent: Intent = opts.intent ?? (/تحد|challenge|حروف|letters/i.test(text) ? 'build' : 'chat');
    const user: ChatMessage = { id: ++seq, role: 'user', text, prompt: opts.prompt, kind: opts.kind };
    const reply: ChatMessage = { id: ++seq, role: 'assistant', text: '', streaming: true };
    const history = [...get().messages, user];
    set({ messages: [...history, reply], phase: 'thinking', status: null, intent, tab: 'chat' });

    const patch = (fn: (m: ChatMessage) => ChatMessage) => set({ messages: get().messages.map((m) => (m.id === reply.id ? fn(m) : m)) });
    const ctrl = new AbortController();
    inflight = ctrl;
    try {
      await streamAssistant(
        {
          uiLang: app.prefs.uiLang,
          screen: app.screen,
          playerId: getPlayerId(),
          messages: history
            .filter((m) => !m.error && (m.text || m.prompt))
            .slice(-12)
            .map((m) => ({
              role: m.role,
              content:
                (m.prompt ?? m.text) +
                (m.challenge ? `\n[challenge created: ${m.challenge.lang}, ${m.challenge.length} letters, ${m.challenge.attempts} attempts, ${m.challenge.difficulty}, topic ${m.challenge.topic ?? '-'}]` : '') +
                (m.quiz ? `\n[quiz asked: ${m.quiz.question}]` : ''),
            })),
          game: buildGameContext(),
          player: aiPlayerContext(app.prefs.uiLang),
        },
        {
          onDelta: (t) => {
            if (ctrl.signal.aborted) return;
            if (get().phase === 'thinking') set({ phase: 'streaming' });
            patch((m) => ({ ...m, text: m.text + t }));
          },
          onStatus: (s) => set({ status: s }),
          onMeta: (meta) => {
            if (ctrl.signal.aborted) return;
            patch((m) => ({ ...m, challenge: meta.challenge, quiz: meta.quiz, candidates: meta.candidates, suggestions: meta.suggestions }));
          },
        },
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      patch((m) => ({ ...m, streaming: false, text: m.text.trim() }));
      haptic(5);
    } catch (e) {
      if ((e as Error).name === 'AbortError' || ctrl.signal.aborted) return;
      patch((m) => ({ ...m, streaming: false, error: true, text: m.text || ax(app.prefs.uiLang).error }));
    } finally {
      if (inflight === ctrl) {
        inflight = null;
        set({ phase: 'idle', status: null });
        saveChat(get().messages);
      }
    }
  },

  react: (mood) => set({ mood, moodTick: get().moodTick + 1 }),
  showNudge: (n) => {
    if (get().open) return;
    set({ nudge: n, mood: 'alert', moodTick: get().moodTick + 1 });
  },
  dismissNudge: () => set({ nudge: null, mood: 'idle' }),
}));
