// WORDLY AI assistant — Supabase Edge Function (Deno), v7.
// The Anthropic key lives in Supabase Vault (service-role RPC) or an env secret; it never reaches the browser.
//
// Capabilities
//  • Custom challenges from natural language or the in-app builder (language, length 3–8, attempts 3–10,
//    difficulty, topic). The word is VALIDATED here (normalized letter count + alphabet) with model retries.
//  • Hint ladder during a round (level 1 → 3), always spoiler-free; every streamed token is masked server-side.
//  • Guess analysis with engine-verified facts + candidate words the player can tap to type into the board.
//  • After a round: tutoring (sentences, synonyms, pronunciation, root) and interactive multiple-choice quizzes.
//  • Player profile awareness (level, streak, learned-words log) for [review] quizzes and [coach] tips.
//  • Dynamic follow-up suggestions after every answer.
// Transport: Server-Sent Events when the client asks for `stream: true` (text deltas, then one `meta` event);
// plain JSON otherwise (backwards compatible with older app bundles).
// Abuse protection: CORS allow-list, input size limits, per-player and per-IP daily caps.

const NL = String.fromCharCode(10);
const MARK = '§§§';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
let cachedKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
async function apiKey(): Promise<string> {
  for (let i = 0; i < 2 && !cachedKey && SERVICE_KEY; i++) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/wordly_ai_key`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (r.ok) cachedKey = String((await r.json()) ?? '');
    else console.error('key lookup failed', r.status, await r.text());
  }
  return cachedKey;
}
const MODEL = 'claude-sonnet-5-5';
const PLAYER_CAP = 120;
const IP_CAP = 300;

const allowedOrigin = (o: string) =>
  o === 'https://wordly-ar.vercel.app' ||
  (o.startsWith('https://wordly-game') && o.endsWith('.vercel.app')) ||
  o.startsWith('http://localhost:') ||
  o.startsWith('http://127.0.0.1:');
function cors(origin: string | null) {
  const ok = origin && allowedOrigin(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin! : 'https://wordly-ar.vercel.app',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
    Vary: 'Origin',
  };
}

// ---- normalization (mirror of the game's rules) ----
const isMark = (p: number) => (p >= 0x610 && p <= 0x61a) || (p >= 0x64b && p <= 0x65f) || p === 0x670 || (p >= 0x6d6 && p <= 0x6ed) || p === 0x640;
const isSpace = (c: string) => c.trim() === '';
const AR_ABC = new Set([...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي', ...'ءؤئةى']);
const EN_ABC = new Set([...'abcdefghijklmnopqrstuvwxyz']);
const normAr = (w: string) => [...w.trim().normalize('NFC')].filter((c) => !isMark(c.codePointAt(0)!) && !isSpace(c)).join('').replace(/[أإآٱ]/g, 'ا');
const normEn = (w: string) => [...w.trim().toLowerCase()].filter((c) => !isSpace(c)).join('');
const norm = (lang: string, w: string) => (lang === 'ar' ? normAr(w) : normEn(w));
const letters = (w: string) => [...w];

type Msg = { role: 'user' | 'assistant'; content: string };
interface GameCtx {
  mode?: string;
  lang?: 'ar' | 'en';
  length?: number;
  maxAttempts?: number;
  difficulty?: string;
  status?: string;
  rows?: { guess: string; pattern: string }[];
  word?: string;
  meaning?: string;
  category?: string;
  knowledge?: { fixed?: [number, string][]; present?: { letter: string; notAt: number[] }[]; absent?: string[] };
}
interface Body {
  uiLang?: 'ar' | 'en';
  screen?: string;
  playerId?: string;
  stream?: boolean;
  messages?: Msg[];
  game?: GameCtx | null;
  player?: PlayerCtx | null;
}
interface PlayerCtx {
  name?: string;
  level?: number;
  title?: string;
  xp?: number;
  streak?: number;
  streakColor?: string;
  best?: number;
  duels?: { w: number; l: number; d: number };
  words?: { w: string; lang: string; m: string; won: boolean }[];
}
interface Challenge {
  lang: 'ar' | 'en';
  length: number;
  attempts: number;
  difficulty: 'easy' | 'normal' | 'hard' | 'expert';
  topic?: string;
  word: string;
  display?: string;
  category: string;
  meaning: string;
  translation?: string;
  pronunciation?: string;
  example?: string;
}
interface Quiz {
  question: string;
  options: string[];
  answer: number;
  explain: string;
}
interface Data {
  challenge: Challenge | null;
  quiz: Quiz | null;
  candidates: string[];
  suggestions: string[];
}
const EMPTY: Data = { challenge: null, quiz: null, candidates: [], suggestions: [] };
const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

function systemPrompt(b: Body): string {
  const ui = b.uiLang === 'en' ? 'English' : 'Arabic (Modern Standard, warm, Saudi-friendly tone)';
  const g = b.game;
  const playing = g && g.status === 'PLAYING';
  const finished = g && g.status && g.status !== 'PLAYING';
  const L: string[] = [];
  L.push(
    `You are "Wordly AI", the playful, brilliant built-in companion of WORDLY — a premium bilingual (Arabic/English) word-guessing game like Wordle.`,
    `Personality: energetic, witty, encouraging, a little magical; use 1–2 fitting emoji per answer at most. Answer in ${ui} unless the player clearly writes in another language.`,
    `Be concise: max ~70 words unless the player asks for more. Format with short lines, "- " bullets and **bold** for key bits. Wrap any word you show as a word-tile in double brackets like [[word]] (only words that are safe to reveal).`,
    `Game rules: guess the hidden word; tiles turn green (right letter, right spot), yellow (in word, wrong spot), grey (not in word). Easy removes grey letters from the keyboard; Hard/Expert force reusing clues. Invalid words never cost an attempt. Arabic: أ إ آ count as ا; ة and ى are separate letters; diacritics are ignored.`,
    `Other features you can mention when relevant: a daily streak (win the main 5-letter game or the daily challenge every day; the flame grows with the streak and its color shows the level won: easy light green, normal dark green, hard red, expert blue), XP levels, a learned-words log, and turn-based duels with friends via a link (same secret word, players alternate, first to solve wins).`,
    ``,
    `OUTPUT FORMAT (strict): first write your answer for the player as plain text. Then a new line containing exactly ${MARK} and then ONE JSON object on the following line(s):`,
    `{"challenge": null|{...}, "quiz": null|{...}, "candidates": [], "suggestions": []}`,
    `- "suggestions": 2–4 short follow-up prompts (max 6 words each, in the player's language, may start with one emoji) that the player can tap next. Make them smart and specific to the moment.`,
    `- "quiz": when the player asks to be quizzed (or "اختبرني"), give ONE multiple-choice question: {"question": string, "options": [4 strings], "answer": index 0-3, "explain": one short sentence}. Do not reveal the answer in your text. Never quiz about the secret word while a round is in progress.`,
    `- "candidates": only when analysing guesses during a round: 2–4 real words in the round's language that fit ALL known facts and have exactly the round's letter count (no diacritics, no "ال" for Arabic). Otherwise [].`,
    ``,
    `CREATING CHALLENGES: when the player asks for a new/custom challenge (including "[builder]" requests), fill "challenge":`,
    `{"lang":"ar"|"en","length":int,"attempts":int,"difficulty":"easy"|"normal"|"hard"|"expert","topic":string,"word":string,"display":string,"category":string,"meaning":string,"translation":string,"pronunciation":string,"example":string}`,
    `- length 3–8 letters, attempts 3–10 (defaults: length 5, attempts 6, normal, the player's language). Respect every parameter the player gave.`,
    `- "word": a real, reasonably common single word WITHOUT spaces, WITHOUT the "ال" prefix for Arabic, WITHOUT diacritics, whose letter count EXACTLY equals "length". Count letters one by one (Arabic ة ى ء ؤ ئ each count as one letter). Match the difficulty: easy = very common, expert = rarer but real.`,
    `- "display" = the word as normally written; "category"/"meaning" short and in the WORD's language; "translation" = Arabic meaning for English words (empty for Arabic); "pronunciation" = IPA for English, fully vocalized form for Arabic; "example" = one natural sentence in the word's language.`,
    `- NEVER reveal the word in your text: announce the challenge with flair (language, letters, attempts, topic) in 2–4 short lines. Do NOT define, describe or hint at the word itself (no riddles, no "light hint") — the player asks for hints later.`,
    `- If the request is impossible (e.g. 12 letters), explain the limits and set "challenge": null.`,
  );
  if (playing) {
    L.push(
      ``,
      `A ROUND IS IN PROGRESS: ${g!.lang === 'ar' ? 'Arabic' : 'English'} word, ${g!.length} letters, ${g!.maxAttempts} attempts (${(g!.rows ?? []).length} used), difficulty ${g!.difficulty}, mode ${g!.mode}.`,
      `Guesses so far (pattern: C=green, P=yellow, A=grey): ${JSON.stringify(g!.rows ?? [])}.`,
      `Engine-verified facts (positions are 1-based): ${JSON.stringify(g!.knowledge ?? {})}.`,
    );
    if (g!.word) {
      L.push(
        `The secret word is "${g!.word}" (category: ${g!.category ?? '-'}, meaning: ${g!.meaning ?? '-'}). THIS IS STRICTLY CONFIDENTIAL.`,
        `NEVER write the secret word, never spell it, never list all its letters, never give rhymes, anagrams or translations that reveal it, and never put it in "candidates" or "suggestions". If the player begs for the answer, refuse playfully and offer a hint.`,
        `HINT LADDER — "[hint:1]" = gentle: the vibe/category or where you would meet it; "[hint:2]" = medium: a riddle about its meaning or use; "[hint:3]" = strong: a vivid near-definition PLUS you may reveal exactly ONE letter that the player has not discovered yet (say which letter, not its position). Without a tag, choose level by how stuck they are.`,
      );
    } else {
      L.push(`You do not know the secret word (daily challenge). You can analyse the guesses, explain the facts and suggest strategy and candidate words consistent with them. For hint requests explain you can only coach strategy in the daily challenge.`);
    }
    L.push(`For "analyse my guesses" / "[analyse]": summarise what is known in 2–4 bullets using the engine facts (never invent facts), then fill "candidates".`);
  } else if (finished && g!.word) {
    L.push(
      ``,
      `THE ROUND IS OVER (${g!.status}). The word was "${g!.word}" (${g!.lang === 'ar' ? 'Arabic' : 'English'}; category: ${g!.category ?? '-'}; meaning: ${g!.meaning ?? '-'}).`,
      `Act as a fun language tutor for this word: example sentences, synonyms/antonyms, pronunciation, root/morphology (Arabic), origin, usage, quizzes about it. You may freely use the word now (show it as [[${g!.word}]]).`,
    );
  }
  const pl = b.player;
  if (pl && typeof pl === 'object') {
    const ws = (Array.isArray(pl.words) ? pl.words : []).slice(0, 14).map((x) => `${String(x.w).slice(0, 12)} (${String(x.lang).slice(0, 2)}, ${x.won ? 'solved' : 'missed'}: ${String(x.m ?? '').slice(0, 60)})`).join('; ');
    const d = pl.duels ?? { w: 0, l: 0, d: 0 };
    L.push(
      ``,
      `PLAYER PROFILE: ${pl.name ? `name "${String(pl.name).slice(0, 24)}", ` : ''}level ${int(pl.level) || 1}${pl.title ? ` (${String(pl.title).slice(0, 24)})` : ''}, ${int(pl.xp)} XP, daily streak ${int(pl.streak)} days${pl.streakColor ? ` (${String(pl.streakColor).slice(0, 16)} flame)` : ''}, best streak ${int(pl.best)}, duels W${int(d.w)}/L${int(d.l)}/D${int(d.d)}.`,
      ws ? `RECENTLY LEARNED WORDS (from their word log): ${ws}.` : `The word log is still empty.`,
      `Use the profile naturally (greet by name sometimes, celebrate streak milestones, adapt difficulty to level) but never dump these stats unprompted.`,
      `"[review]" = spaced-repetition review of the learned words: pick ONE word from the log (prefer missed ones) and fill "quiz" with a multiple-choice question about its meaning or usage (it is safe to show those words). If the log is empty, say so kindly and suggest playing a round. "[coach]" = 3 short personalised tips from their profile and level, plus one suggested next challenge in "suggestions".`,
    );
  }
  if (b.screen) L.push(``, `Current screen: ${String(b.screen).slice(0, 20)}.`);
  return L.join(NL);
}

// ---- Anthropic ----
async function claudeRequest(system: string, messages: Msg[], stream: boolean, maxTokens = 2000): Promise<Response> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': await apiKey(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages, stream }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}
async function callClaude(system: string, messages: Msg[], maxTokens = 2000): Promise<string> {
  const data = await (await claudeRequest(system, messages, false, maxTokens)).json();
  return (data.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
}
/** Streams text deltas from Anthropic's SSE response. */
async function* claudeStream(system: string, messages: Msg[]): AsyncGenerator<string> {
  const res = await claudeRequest(system, messages, true);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf(NL)) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      try {
        const ev = JSON.parse(line.slice(5).trim());
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') yield String(ev.delta.text ?? '');
        if (ev.type === 'error') throw new Error('stream error ' + JSON.stringify(ev.error));
      } catch (e) {
        if (String(e).includes('stream error')) throw e;
      }
    }
  }
}

// ---- parsing & validation ----
function parseData(raw: string): Data | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(raw.slice(start, end + 1));
    return {
      challenge: o.challenge && typeof o.challenge === 'object' ? o.challenge : null,
      quiz: o.quiz && typeof o.quiz === 'object' ? o.quiz : null,
      candidates: Array.isArray(o.candidates) ? o.candidates.map(String) : [],
      suggestions: Array.isArray(o.suggestions) ? o.suggestions.map(String) : [],
    };
  } catch {
    return null;
  }
}
function split(full: string): { reply: string; data: Data | null } {
  const m = full.indexOf(MARK);
  if (m < 0) {
    // tolerate the legacy all-JSON shape
    const t = full.trim();
    if (t.startsWith('{')) {
      try {
        const o = JSON.parse(t.slice(0, t.lastIndexOf('}') + 1));
        return { reply: String(o.reply ?? ''), data: parseData(t) };
      } catch {
        /* fall through */
      }
    }
    return { reply: t, data: null };
  }
  return { reply: full.slice(0, m).trim(), data: parseData(full.slice(m + MARK.length)) };
}

/** Returns an error description, or null when the challenge is valid (and normalizes it in place). */
function checkChallenge(c: Challenge): string | null {
  if (c.lang !== 'ar' && c.lang !== 'en') return 'lang must be "ar" or "en"';
  const w = norm(c.lang, String(c.word ?? ''));
  const abc = c.lang === 'ar' ? AR_ABC : EN_ABC;
  const n = letters(w).length;
  if (!w) return 'word is empty';
  if (!letters(w).every((x) => abc.has(x))) return `word "${c.word}" contains characters outside the ${c.lang} alphabet`;
  if (c.lang === 'ar' && w.startsWith('ال') && n > 4) return `remove the "ال" prefix from "${c.word}"`;
  const wanted = Number(c.length);
  if (!Number.isInteger(wanted) || wanted < 3 || wanted > 8) return 'length must be 3–8';
  if (n !== wanted) return `"${c.word}" has ${n} letters (${letters(w).join(' ')}), but length must be ${wanted}. Choose a different word with exactly ${wanted} letters.`;
  const attempts = Number(c.attempts);
  c.attempts = Number.isInteger(attempts) ? Math.min(10, Math.max(3, attempts)) : 6;
  if (!['easy', 'normal', 'hard', 'expert'].includes(c.difficulty)) c.difficulty = 'normal';
  c.word = w;
  c.length = n;
  c.display = c.display && norm(c.lang, c.display) === w ? c.display : w;
  for (const k of ['category', 'meaning', 'translation', 'pronunciation', 'example', 'topic'] as const) c[k] = String(c[k] ?? '').slice(0, 300);
  if (c.lang === 'ar' && c.pronunciation && normAr(c.pronunciation) !== w) c.pronunciation = c.display;
  return null;
}

function secretOf(game?: GameCtx | null): { secret: string; lang: string } | null {
  if (!game?.word || game.status !== 'PLAYING') return null;
  const lang = game.lang ?? 'en';
  const secret = norm(lang, game.word);
  return secret ? { secret, lang } : null;
}
/** Masks any token that contains the secret (compared in normalized space so diacritics/case can't hide it). */
function maskText(text: string, game?: GameCtx | null): string {
  const s = secretOf(game);
  if (!s) return text;
  const abc = s.lang === 'ar' ? AR_ABC : EN_ABC;
  let out = '';
  let tok = '';
  const flush = () => {
    if (tok) out += letters(norm(s.lang, tok)).filter((c) => abc.has(c)).join('').includes(s.secret) ? '■'.repeat(letters(s.secret).length) : tok;
    tok = '';
  };
  for (const ch of text) {
    if (isSpace(ch)) {
      flush();
      out += ch;
    } else tok += ch;
  }
  flush();
  return out;
}

function cleanData(d: Data, body: Body): Data {
  const g = body.game;
  const s = secretOf(g);
  const out: Data = { challenge: d.challenge, quiz: null, candidates: [], suggestions: [] };
  out.suggestions = d.suggestions.map((x) => maskText(x.slice(0, 60), g)).filter((x) => x && !x.includes('■')).slice(0, 4);
  if (d.quiz && Array.isArray(d.quiz.options) && d.quiz.options.length >= 2 && !s) {
    const answer = Number(d.quiz.answer);
    if (Number.isInteger(answer) && answer >= 0 && answer < d.quiz.options.length)
      out.quiz = { question: String(d.quiz.question ?? '').slice(0, 300), options: d.quiz.options.slice(0, 4).map((o) => String(o).slice(0, 120)), answer, explain: String(d.quiz.explain ?? '').slice(0, 300) };
  }
  if (g && g.status === 'PLAYING' && g.lang && g.length) {
    const abc = g.lang === 'ar' ? AR_ABC : EN_ABC;
    const seen = new Set<string>();
    for (const c of d.candidates) {
      const w = norm(g.lang, c);
      if (letters(w).length !== g.length || !letters(w).every((x) => abc.has(x))) continue;
      if (s && w === s.secret) continue; // never hand over the answer
      if (seen.has(w)) continue;
      seen.add(w);
      out.candidates.push(w);
    }
    out.candidates = out.candidates.slice(0, 4);
  }
  return out;
}

/** Validates the challenge and asks the model to fix it (up to 2 corrections, data-only). */
async function settleChallenge(system: string, convo: Msg[], full: string, data: Data, uiLang?: string): Promise<{ data: Data; notice?: string }> {
  let current = data;
  let last = full;
  for (let attempt = 0; current.challenge && attempt < 3; attempt++) {
    const problem = checkChallenge(current.challenge);
    if (!problem) return { data: current };
    if (attempt === 2) break;
    const fix = await callClaude(system, [
      ...convo,
      { role: 'assistant', content: last },
      { role: 'user', content: `VALIDATION FAILED: ${problem} Reply with ONLY the corrected JSON object (same keys: challenge, quiz, candidates, suggestions) — no prose, no ${MARK}.` },
    ], 1200);
    last = fix;
    const parsed = parseData(fix);
    current = parsed ? { ...current, challenge: parsed.challenge } : { ...current, challenge: null };
  }
  return {
    data: { ...current, challenge: null },
    notice: uiLang === 'en' ? 'I could not find a valid word for that exact request — try another length or topic.' : 'ما لقيت كلمة مناسبة بهذا الطلب بالضبط — جرّب طولاً أو موضوعاً مختلفاً.',
  };
}

async function withinCap(key: string, cap: number): Promise<boolean> {
  if (!SERVICE_KEY) return true;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/wordly_ai_hit`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: key, p_cap: cap }),
    });
    return r.ok ? (await r.json()) === true : true;
  } catch {
    return true;
  }
}

const sse = (event: string, data: unknown) => `event: ${event}${NL}data: ${JSON.stringify(data)}${NL}${NL}`;

Deno.serve(async (req) => {
  const base = cors(req.headers.get('origin'));
  const json = { ...base, 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: json });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method' }), { status: 405, headers: json });
  if (!(await apiKey())) return new Response(JSON.stringify({ error: 'AI is not configured' }), { status: 500, headers: json });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers: json });
  }
  const messages = (body.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 900) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') return new Response(JSON.stringify({ error: 'no message' }), { status: 400, headers: json });
  while (messages.length && messages[0].role !== 'user') messages.shift();

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const player = /^[0-9a-f-]{36}$/i.test(body.playerId ?? '') ? body.playerId! : 'anon';
  const limited = !(await withinCap(`p:${player}`, PLAYER_CAP)) || !(await withinCap(`ip:${ip}`, IP_CAP));
  const limitReply = body.uiLang === 'en' ? 'You have reached today’s assistant limit. Come back tomorrow! 🌙' : 'وصلت للحد اليومي للمساعد. نلتقي غداً 🌙';
  const system = systemPrompt(body);

  // ---------- legacy JSON path ----------
  if (!body.stream) {
    if (limited) return new Response(JSON.stringify({ reply: limitReply, challenge: null, limited: true }), { status: 200, headers: json });
    try {
      const full = await callClaude(system, messages);
      const parts = split(full);
      let data = parts.data ?? EMPTY;
      let notice: string | undefined;
      if (data.challenge) ({ data, notice } = await settleChallenge(system, messages, full, data, body.uiLang));
      data = cleanData(data, body);
      const reply = maskText(notice ? `${parts.reply}${NL}${NL}${notice}` : parts.reply, body.game);
      return new Response(JSON.stringify({ reply, ...data }), { status: 200, headers: json });
    } catch (e) {
      console.error(e);
      return new Response(JSON.stringify({ error: 'assistant unavailable' }), { status: 502, headers: json });
    }
  }

  // ---------- streaming path ----------
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (event: string, data: unknown) => ctrl.enqueue(enc.encode(sse(event, data)));
      try {
        if (limited) {
          send('delta', { t: limitReply });
          send('meta', { ...EMPTY, limited: true });
          send('done', {});
          return ctrl.close();
        }
        let full = '';
        let emitted = 0;
        let replyDone = false;
        for await (const t of claudeStream(system, messages)) {
          full += t;
          if (replyDone) continue;
          const m = full.indexOf(MARK);
          let limit = emitted;
          if (m >= 0) {
            replyDone = true;
            limit = m;
          } else {
            // only emit complete tokens so the mask always sees whole words
            for (let i = full.length - 1; i >= emitted; i--) {
              if (isSpace(full[i])) {
                limit = i + 1;
                break;
              }
            }
          }
          if (limit > emitted) {
            send('delta', { t: maskText(full.slice(emitted, limit), body.game) });
            emitted = limit;
          }
        }
        if (!replyDone && full.length > emitted) send('delta', { t: maskText(full.slice(emitted), body.game) });
        const parts = split(full);
        let data = parts.data ?? EMPTY;
        if (data.challenge) {
          send('status', { s: 'validating' });
          const settled = await settleChallenge(system, messages, full, data, body.uiLang);
          data = settled.data;
          if (settled.notice) send('delta', { t: `${NL}${NL}${settled.notice}` });
        }
        send('meta', cleanData(data, body));
        send('done', {});
      } catch (e) {
        console.error(e);
        send('error', { error: 'assistant unavailable' });
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { ...base, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' } });
});
