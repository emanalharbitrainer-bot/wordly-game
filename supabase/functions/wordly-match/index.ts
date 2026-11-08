// WORDLY duels — Supabase Edge Function (Deno).
// Creates a turn-based match whose secret word is chosen by Claude on the server and validated
// (normalized letter count + alphabet), so neither player can see it. Also starts rematches.
// The Anthropic key comes from Supabase Vault through a service-role RPC; it never reaches the browser.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MODEL = 'claude-sonnet-5-5';
let cachedKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

const allowedOrigin = (o: string) =>
  o === 'https://wordly-ar.vercel.app' || (o.startsWith('https://wordly-game') && o.endsWith('.vercel.app')) || o.startsWith('http://localhost:') || o.startsWith('http://127.0.0.1:');
const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && allowedOrigin(origin) ? origin : 'https://wordly-ar.vercel.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
  'Content-Type': 'application/json',
  Vary: 'Origin',
});

async function rpc(name: string, body: unknown): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`rpc ${name} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}
async function apiKey(): Promise<string> {
  for (let i = 0; i < 2 && !cachedKey && SERVICE_KEY; i++) cachedKey = String((await rpc('wordly_ai_key', {})) ?? '');
  return cachedKey;
}

const isMark = (p: number) => (p >= 0x610 && p <= 0x61a) || (p >= 0x64b && p <= 0x65f) || p === 0x670 || (p >= 0x6d6 && p <= 0x6ed) || p === 0x640;
const isSpace = (c: string) => c.trim() === '';
const AR_ABC = new Set([...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي', ...'ءؤئةى']);
const EN_ABC = new Set([...'abcdefghijklmnopqrstuvwxyz']);
const normAr = (w: string) => [...w.trim().normalize('NFC')].filter((c) => !isMark(c.codePointAt(0)!) && !isSpace(c)).join('').replace(/[أإآٱ]/g, 'ا');
const normEn = (w: string) => [...w.trim().toLowerCase()].filter((c) => !isSpace(c)).join('');
const norm = (lang: string, w: string) => (lang === 'ar' ? normAr(w) : normEn(w));

const TOPICS = ['nature', 'animals', 'food', 'home', 'city life', 'travel', 'sports', 'science', 'space', 'the sea', 'weather', 'feelings', 'school', 'work', 'music', 'art', 'technology', 'health', 'family', 'clothes', 'plants', 'history', 'desert life', 'colors and light', 'tools', 'body', 'time', 'games', 'books', 'kitchen'];
const RARITY: Record<string, string> = { easy: 'very common, everyday', normal: 'common', hard: 'less common but well known', expert: 'rare but real and correct' };

interface Word { word: string; display: string; category: string; meaning: string; translation: string; pronunciation: string; example: string }

async function pickWord(lang: 'ar' | 'en', length: number, difficulty: string): Promise<Word> {
  const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];
  const seed = Math.floor(Math.random() * 100000);
  const system = [
    'You pick secret words for WORDLY, a Wordle-style duel game. Reply with ONE JSON object and nothing else:',
    '{"word": string, "display": string, "category": string, "meaning": string, "translation": string, "pronunciation": string, "example": string}',
    `Rules: a real single ${lang === 'ar' ? 'Arabic' : 'English'} word, ${RARITY[difficulty] ?? 'common'}, with EXACTLY ${length} letters, no spaces, no diacritics${lang === 'ar' ? ', no "ال" prefix (count ة ى ء ؤ ئ as one letter each)' : ''}. Not a proper noun, not offensive.`,
    '"display" = how it is normally written; "category" and "meaning" short, in the word language; "translation" = Arabic meaning for English words, empty for Arabic; "pronunciation" = IPA for English, fully vocalized for Arabic; "example" = one natural sentence.',
  ].join(' ');
  const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: `Topic hint: ${topic}. Variety seed: ${seed}. Pick the word now.` }];
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': await apiKey(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 500, system, messages }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data = await res.json();
    const text = (data.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
    let o: Partial<Word> = {};
    try {
      o = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    } catch {
      /* retry below */
    }
    const w = norm(lang, String(o.word ?? ''));
    const abc = lang === 'ar' ? AR_ABC : EN_ABC;
    let problem = '';
    if (!w) problem = 'no word';
    else if (![...w].every((c) => abc.has(c))) problem = `"${o.word}" has characters outside the alphabet`;
    else if (lang === 'ar' && w.startsWith('ال') && length > 3) problem = `remove the "ال" prefix`;
    else if ([...w].length !== length) problem = `"${o.word}" has ${[...w].length} letters (${[...w].join(' ')}), need exactly ${length}`;
    if (!problem) {
      return {
        word: w,
        display: o.display && norm(lang, o.display) === w ? String(o.display) : w,
        category: String(o.category ?? '').slice(0, 120),
        meaning: String(o.meaning ?? '').slice(0, 300),
        translation: String(o.translation ?? '').slice(0, 200),
        pronunciation: String(o.pronunciation ?? '').slice(0, 120),
        example: String(o.example ?? '').slice(0, 300),
      };
    }
    messages.push({ role: 'assistant', content: text || '{}' }, { role: 'user', content: `Invalid: ${problem}. Reply with a corrected JSON object only.` });
  }
  throw new Error('no valid word');
}

async function withinCap(key: string, cap: number): Promise<boolean> {
  try {
    return (await rpc('wordly_ai_hit', { p_key: key, p_cap: cap })) === true;
  } catch {
    return true;
  }
}

Deno.serve(async (req) => {
  const headers = cors(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method' }), { status: 405, headers });
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers });
  }
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  if (!(await withinCap(`m:${ip}`, 80))) return new Response(JSON.stringify({ error: 'limited' }), { status: 200, headers });
  try {
    if (b.action === 'rematch') {
      const id = String(b.id ?? '').toUpperCase();
      const state = await rpc('wordly_match_state', { p_id: id, p_seat_token: String(b.seatToken ?? ''), p_since: null });
      if (!state || !state.mySeat) return new Response(JSON.stringify({ error: 'seat' }), { status: 200, headers });
      if (state.rematchId) return new Response(JSON.stringify({ id: state.rematchId, existing: true }), { status: 200, headers });
      if (state.status !== 'finished') return new Response(JSON.stringify({ error: 'status' }), { status: 200, headers });
      const word = await pickWord(state.lang, state.length, state.difficulty);
      const out = await rpc('wordly_match_create_internal', { p_cfg: { seat: state.mySeat }, p_word: word, p_prev: id });
      return new Response(JSON.stringify(out), { status: 200, headers });
    }
    const lang = b.lang === 'en' ? 'en' : 'ar';
    const length = Math.min(8, Math.max(3, Math.round(Number(b.length) || 5)));
    const max = b.maxAttempts === null || b.maxAttempts === 'inf' ? null : Math.min(30, Math.max(2, Math.round(Number(b.maxAttempts) || 6)));
    const difficulty = ['easy', 'normal', 'hard', 'expert'].includes(String(b.difficulty)) ? String(b.difficulty) : 'normal';
    const first = ['host', 'guest', 'random'].includes(String(b.first)) ? String(b.first) : 'host';
    const word = await pickWord(lang, length, difficulty);
    const cfg = {
      lang, length, maxAttempts: max === null ? '' : String(max), difficulty, first,
      name: String(b.name ?? '').slice(0, 24), avatar: String(b.avatar ?? '🦊').slice(0, 8), color: String(b.color ?? 'green').slice(0, 16),
      accountToken: b.accountToken ? String(b.accountToken) : null, invite: b.invite ? String(b.invite).slice(0, 20) : null,
    };
    const out = await rpc('wordly_match_create_internal', { p_cfg: cfg, p_word: word, p_prev: null });
    return new Response(JSON.stringify(out), { status: 200, headers });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: 'unavailable' }), { status: 502, headers });
  }
});
