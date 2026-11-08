#!/usr/bin/env node
/**
 * Builds WORDLY dictionaries from reviewed sources (runs before every production build).
 *
 * Sources
 *  - English guesses : SCOWL via the `wordlist-english` npm package (levels 10-55,
 *                      english + american + british spellings).
 *  - Arabic guesses  : the Arabic frequency list shipped inside the `pyspellchecker` 0.9.1
 *                      wheel (pinned by SHA-256), filtered by a minimum frequency to drop typos.
 *                      Uses data/sources/ar-frequency.json.gz when present (offline dev),
 *                      otherwise downloads the pinned wheel from PyPI and verifies its hash.
 *  - Answers         : hand-curated data/curated/{en,ar}.tsv + learning-card data
 *                      ({en,ar}-learning.tsv). Every answer must exist in the reference
 *                      source for its language, otherwise the build FAILS.
 *
 * Outputs
 *  - public/dictionaries/{lang}.json   guesses + non-daily answers (lazy-loaded by the app)
 *  - supabase/seed_daily_words.sql     daily words (server-only, never shipped to the browser)
 *
 * The Arabic normalization MUST match src/core/localization/arabic/normalize.ts — the unit
 * tests re-normalize the published dictionary to prove it.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, inflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORD_LENGTH = 5;
const AR_MIN_FREQUENCY = 4;
const LEVELS = ['easy', 'normal', 'hard', 'expert', 'daily'];
const WHEEL_URL =
  'https://files.pythonhosted.org/packages/7f/3b/558bc6def007152f0128ff0c8a6825708ac22bafdb295dc85cbec1f6ec22/pyspellchecker-0.9.1-py3-none-any.whl';
const WHEEL_SHA256 = 'c79b144b4bad20024bf489ad3ffd96b76f3f53439e9fa59ac607896352852f3d';

// ---- normalization (mirror of normalize.ts, default game rules) ----
const AR_MARKS = new RegExp('[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06ED\\u0640]', 'g');
const AR_ALPHABET = new Set([...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي', ...'ءؤئةى']);
const normalizeAr = (w) => w.trim().normalize('NFC').replace(AR_MARKS, '').replace(/[أإآٱ]/g, 'ا');
const normalizeEn = (w) => w.trim().toLowerCase();
const len = (w) => [...w].length;
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

function readLines(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim() && !l.startsWith('#'));
}

function loadTsv(lang) {
  return readLines(`data/curated/${lang}.tsv`).map((line, i) => {
    const parts = line.split('\t').map((p) => p.trim());
    if (parts.length !== 4) fail(`${lang}.tsv:${i + 1}: expected 4 tab-separated columns`);
    const [display, level, category, meaning] = parts;
    if (!LEVELS.includes(level)) fail(`${lang}.tsv: unknown level ${level}`);
    return { display, level, category, meaning };
  });
}

function loadLearning(lang) {
  const out = new Map();
  for (const line of readLines(`data/curated/${lang}-learning.tsv`)) {
    const parts = line.split('\t').map((p) => p.trim());
    if (lang === 'en') {
      const [word, t, p, e] = parts;
      out.set(normalizeEn(word), { t, p, e });
    } else {
      const [word, p, e] = parts;
      out.set(normalizeAr(word), { p, e });
    }
  }
  return out;
}

/** Arabic root + English translation for every Arabic answer (learning card + root hint). */
function loadRoots() {
  const out = new Map();
  for (const line of readLines('data/curated/ar-roots.tsv')) {
    const [word, r, t] = line.split('\t').map((p) => p.trim());
    if (!word || !r || !t) fail(`ar-roots.tsv: incomplete line "${line}"`);
    out.set(normalizeAr(word), { r, t });
  }
  return out;
}

/** Themed word packs (data/curated/packs.tsv) — validated like curated answers. */
function loadPacks(lang, reference, dailyWords) {
  const norm = lang === 'ar' ? normalizeAr : normalizeEn;
  const alphabet = lang === 'ar' ? AR_ALPHABET : new Set('abcdefghijklmnopqrstuvwxyz');
  const packs = {};
  const errors = [];
  for (const line of readLines('data/curated/packs.tsv')) {
    const [pack, display, c, m, p, e, t, r] = line.split('\t').map((x) => x.trim());
    if (!pack.startsWith(`${lang}-`)) continue;
    const w = norm(display);
    if (!display || !c || !m || !p || !e || !t) errors.push(`${pack}/${display}: missing column`);
    if (len(w) !== WORD_LENGTH) errors.push(`${pack}/${display}: ${len(w)} letters`);
    if (![...w].every((ch) => alphabet.has(ch))) errors.push(`${pack}/${display}: letters outside the alphabet`);
    if (lang === 'ar' && normalizeAr(p) !== w) errors.push(`${pack}/${display}: vocalized form ${p} does not match`);
    if (lang === 'ar' && !r) errors.push(`${pack}/${display}: missing root`);
    // English city names are proper nouns (not in SCOWL); every other pack word must be a real dictionary word.
    if (pack !== 'en-cities' && !reference.has(w)) errors.push(`${pack}/${display}: not found in the reference dictionary`);
    if (dailyWords.has(w)) errors.push(`${pack}/${display}: is a daily-challenge word (would leak it)`);
    const list = (packs[pack] ??= []);
    if (list.some((a) => a.w === w)) errors.push(`${pack}/${display}: duplicate`);
    list.push({ w, d: display, c, m, p, e, t, ...(lang === 'ar' ? { r } : {}) });
  }
  for (const [id, list] of Object.entries(packs)) if (list.length !== 12) errors.push(`${id}: expected 12 words, found ${list.length}`);
  if (errors.length) fail(`[${lang}] packs failed review:\n  ${errors.join('\n  ')}`);
  return packs;
}

function englishGuesses() {
  const words = new Set();
  for (const variant of ['english', 'american', 'british']) {
    for (const level of [10, 20, 35, 40, 50, 55]) {
      const list = JSON.parse(readFileSync(join(ROOT, `node_modules/wordlist-english/${variant}-words-${level}.json`), 'utf8'));
      for (const w of list) if (/^[a-z]{5}$/.test(w)) words.add(w);
    }
  }
  return words;
}

/** Minimal ZIP reader: returns the inflated bytes of one entry. */
function unzipEntry(zip, name) {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) fail('wheel: end of central directory not found');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(p + 10);
    const csize = zip.readUInt32LE(p + 20);
    const nlen = zip.readUInt16LE(p + 28);
    const xlen = zip.readUInt16LE(p + 30);
    const clen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const entry = zip.toString('utf8', p + 46, p + 46 + nlen);
    if (entry === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + csize);
      return method === 0 ? data : inflateRawSync(data);
    }
    p += 46 + nlen + xlen + clen;
  }
  fail(`wheel: ${name} not found`);
}

async function arabicFrequency() {
  const local = join(ROOT, 'data/sources/ar-frequency.json.gz');
  let gz;
  if (existsSync(local)) {
    gz = readFileSync(local);
  } else {
    console.log('downloading pinned pyspellchecker 0.9.1 wheel…');
    const res = await fetch(WHEEL_URL);
    if (!res.ok) fail(`wheel download failed: ${res.status}`);
    const wheel = Buffer.from(await res.arrayBuffer());
    const sha = createHash('sha256').update(wheel).digest('hex');
    if (sha !== WHEEL_SHA256) fail(`wheel hash mismatch: ${sha}`);
    gz = unzipEntry(wheel, 'spellchecker/resources/ar.json.gz');
  }
  return JSON.parse(gunzipSync(gz).toString('utf8'));
}

function arabicGuesses(freq) {
  const words = new Set();
  for (const [raw, count] of Object.entries(freq)) {
    if (count < AR_MIN_FREQUENCY) continue;
    const w = normalizeAr(raw);
    if (len(w) === WORD_LENGTH && [...w].every((c) => AR_ALPHABET.has(c))) words.add(w);
  }
  return words;
}

function arabicReference(freq) {
  const ref = new Set(Object.keys(freq).map(normalizeAr));
  for (const w of readLines('data/curated/ar-reviewed-additions.txt')) ref.add(normalizeAr(w));
  return ref;
}

const ROOTS = loadRoots();
const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function build(lang, guesses, reference) {
  const norm = lang === 'ar' ? normalizeAr : normalizeEn;
  const alphabet = lang === 'ar' ? AR_ALPHABET : new Set('abcdefghijklmnopqrstuvwxyz');
  const learning = loadLearning(lang);
  const seen = new Set();
  const errors = [];
  const answers = Object.fromEntries(LEVELS.map((l) => [l, []]));
  for (const r of loadTsv(lang)) {
    const w = norm(r.display);
    if (len(w) !== WORD_LENGTH) errors.push(`${r.display}: ${len(w)} letters after normalization`);
    if (![...w].every((c) => alphabet.has(c))) errors.push(`${r.display}: letters outside the ${lang} alphabet`);
    if (seen.has(w)) errors.push(`${r.display}: duplicate answer`);
    if (!reference.has(w)) errors.push(`${r.display}: not found in the reference dictionary`);
    seen.add(w);
    const extra = learning.get(w);
    if (!extra) errors.push(`${r.display}: missing learning-card entry`);
    if (lang === 'ar') {
      const root = ROOTS.get(w);
      if (!root) errors.push(`${r.display}: missing root/translation in ar-roots.tsv`);
      else Object.assign(extra ?? {}, root);
    }
    else if (lang === 'ar' && normalizeAr(extra.p) !== w) errors.push(`${r.display}: vocalized form ${extra.p} does not match`);
    answers[r.level].push({ w, d: r.display, c: r.category, m: r.meaning, ...(extra ?? {}) });
  }
  if (errors.length) fail(`[${lang}] curated list failed review:\n  ${errors.join('\n  ')}`);
  for (const w of seen) guesses.add(w);
  const daily = answers.daily;
  delete answers.daily;
  const packs = loadPacks(lang, lang === 'ar' ? reference : guesses, new Set(daily.map((a) => a.w)));
  for (const list of Object.values(packs)) for (const a of list) guesses.add(a.w);
  const out = {
    version: 1,
    lang,
    length: WORD_LENGTH,
    source:
      lang === 'en'
        ? 'SCOWL (wordlist-english) + curated answers'
        : `pyspellchecker Arabic frequency list (min frequency ${AR_MIN_FREQUENCY}) + curated answers`,
    guesses: [...guesses].sort(byCodePoint),
    answers,
  };
  mkdirSync(join(ROOT, 'public/dictionaries'), { recursive: true });
  writeFileSync(join(ROOT, `public/dictionaries/${lang}.json`), JSON.stringify(out));
  writeFileSync(join(ROOT, `public/dictionaries/packs-${lang}.json`), JSON.stringify({ version: 1, lang, packs }));
  console.log(`[${lang}] guesses=${out.guesses.length} ${Object.entries(answers).map(([k, v]) => `${k}=${v.length}`).join(' ')} daily=${daily.length}`);
  return daily;
}

const sql = (s) => `'${String(s).replace(/'/g, "''")}'`;

const freq = await arabicFrequency();
const en = englishGuesses();
const dailyEn = build('en', en, new Set(en));
const dailyAr = build('ar', arabicGuesses(freq), arabicReference(freq));

const values = [
  ...dailyEn.map((a) => ['en', a]),
  ...dailyAr.map((a) => ['ar', a]),
].map(([lang, a]) => `  (${sql(lang)}, ${sql(a.w)}, ${sql(a.d)}, ${sql(a.c)}, ${sql(a.m)}, ${a.t ? sql(a.t) : 'null'}, ${sql(a.p)}, ${sql(a.e)}, ${a.r ? sql(a.r) : 'null'})`);
// Public builds (e.g. Vercel) carry no daily words: they live only in the database.
if (values.length) {
mkdirSync(join(ROOT, 'supabase'), { recursive: true });
writeFileSync(
  join(ROOT, 'supabase/seed_daily_words.sql'),
  [
    '-- Generated by scripts/build-dictionaries.mjs — daily challenge words (server-only).',
    'insert into public.wordly_daily_words (lang, word, display, category, meaning, translation, pronunciation, example, root) values',
    values.join(',\n'),
    'on conflict (lang, word) do update set display = excluded.display, category = excluded.category, meaning = excluded.meaning, translation = excluded.translation, pronunciation = excluded.pronunciation, example = excluded.example, root = excluded.root;',
    '',
  ].join('\n'),
);
}
console.log(`daily words seeded: ${values.length}`);

// ---- Extra word lengths for AI custom challenges (guess lists only; no curated answers) ----
export const EXTRA_LENGTHS = [3, 4, 6, 7, 8];
function writeLengthList(lang, n, words) {
  const out = { version: 1, lang, length: n, source: lang === 'en' ? 'SCOWL (wordlist-english)' : `pyspellchecker Arabic frequency list (min frequency ${AR_MIN_FREQUENCY})`, guesses: [...words].sort(byCodePoint), answers: { easy: [], normal: [], hard: [], expert: [] } };
  writeFileSync(join(ROOT, `public/dictionaries/${lang}-${n}.json`), JSON.stringify(out));
  return out.guesses.length;
}
{
  const enByLen = new Map(EXTRA_LENGTHS.map((n) => [n, new Set()]));
  for (const variant of ['english', 'american', 'british']) {
    for (const level of [10, 20, 35, 40, 50, 55]) {
      for (const w of JSON.parse(readFileSync(join(ROOT, `node_modules/wordlist-english/${variant}-words-${level}.json`), 'utf8'))) {
        if (/^[a-z]+$/.test(w) && enByLen.has(w.length)) enByLen.get(w.length).add(w);
      }
    }
  }
  const arByLen = new Map(EXTRA_LENGTHS.map((n) => [n, new Set()]));
  for (const [raw, count] of Object.entries(freq)) {
    if (count < AR_MIN_FREQUENCY) continue;
    const w = normalizeAr(raw);
    const n = len(w);
    if (arByLen.has(n) && [...w].every((c) => AR_ALPHABET.has(c))) arByLen.get(n).add(w);
  }
  for (const n of EXTRA_LENGTHS) console.log(`[len ${n}] en=${writeLengthList('en', n, enByLen.get(n))} ar=${writeLengthList('ar', n, arByLen.get(n))}`);
}
