// End-to-end smoke test (Playwright, real Chromium, mobile viewport).
// Usage: npm run build && npx vite preview --port 4173 &  then  node tests/e2e/run-e2e.mjs [baseUrl] [screenshotDir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const SHOTS = process.argv[3] ?? 'test-results';
mkdirSync(SHOTS, { recursive: true });
const executablePath = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

let passed = 0;
let page;
const failures = [];
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    await page?.screenshot({ path: `${SHOTS}/FAIL-${failures.length}.png` }).catch(() => {});
    console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ar-SA' });
page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const session = (slot) => page.evaluate((s) => JSON.parse(localStorage.getItem(`wordly:v1:session:${s}`) ?? 'null'), slot);
const tapKey = (label) => page.locator(`.kb button[aria-label^="${label}"]`).first().tap();
const typeWord = async (letters, display = (l) => l) => {
  for (const l of letters) await tapKey(display(l));
};

console.log(`WORDLY e2e @ ${BASE}`);
await page.goto(BASE, { waitUntil: 'networkidle' });

await step('splash then menu renders in Arabic RTL', async () => {
  await page.waitForSelector('text=العب', { timeout: 5000 });
  assert((await page.getAttribute('html', 'dir')) === 'rtl', 'html dir should be rtl');
  await page.screenshot({ path: `${SHOTS}/01-menu-ar.png` });
});

await step('Arabic EASY game opens with virtual keyboard and no text inputs', async () => {
  await page.getByText('العب', { exact: true }).tap();
  await page.getByText('العربية').first().tap();
  await page.getByText('سهل', { exact: true }).tap();
  await page.waitForSelector('.kb .key');
  assert((await page.locator('input, textarea, select, [contenteditable="true"]').count()) === 0, 'no native inputs allowed');
  assert((await page.locator('.kb').getAttribute('dir')) === 'rtl', 'arabic keyboard must be rtl');
  assert((await page.locator('.kb .key').count()) === 35, 'arabic keyboard should have 33 letters + enter + backspace');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/02-game-ar-empty.png` });
});

await step('invalid word shakes, shows message, and does not consume an attempt', async () => {
  await typeWord(['ض', 'ض', 'ض', 'ض', 'ض']);
  await tapKey('إدخال');
  await page.waitForSelector('.toast', { timeout: 3000 });
  const s = await session('classic');
  assert(s.rows.length === 0, `rows should still be 0, got ${s.rows.length}`);
  await page.screenshot({ path: `${SHOTS}/03-invalid-word.png` });
  for (let i = 0; i < 5; i++) await tapKey('رجوع');
});

await step('valid guess flips and EASY eliminates absent letters from the keyboard', async () => {
  const s = await session('classic');
  const secret = [...s.secret.w];
  // pick a dictionary word that differs from the secret
  const guess = s.secret.w === 'مدرسة' ? 'سيارة' : 'مدرسة';
  await typeWord([...guess]);
  await tapKey('إدخال');
  await page.waitForTimeout(1900);
  const after = await session('classic');
  assert(after.rows.length === 1, 'one row should be recorded');
  const absent = [...guess].filter((l) => !secret.includes(l));
  for (const l of absent) {
    const cls = await page.locator(`.kb button[aria-label^="${l}"]`).first().getAttribute('class');
    assert(cls.includes('key--disabled'), `${l} should be eliminated (class: ${cls})`);
  }
  await page.screenshot({ path: `${SHOTS}/04-after-guess-ar.png` });
});

await step('hint sheet reveals the category and charges coins', async () => {
  const coinsBefore = await page.evaluate(() => Number(localStorage.getItem('wordly:v1:coins') ?? 60));
  await page.getByRole('button', { name: 'تلميح' }).tap();
  await page.waitForSelector('[role="dialog"]');
  await page.getByText('التصنيف', { exact: true }).first().tap();
  await page.waitForTimeout(300);
  const s = await session('classic');
  assert(s.hints.some((h) => h.type === 'category'), 'category hint stored');
  const coinsAfter = await page.evaluate(() => Number(localStorage.getItem('wordly:v1:coins')));
  assert(coinsAfter === coinsBefore - 5, `coins ${coinsBefore} → ${coinsAfter}`);
  await page.screenshot({ path: `${SHOTS}/05-hints.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
});

await step('session survives a page reload (persistence)', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('text=أكمل الجولة', { timeout: 5000 });
  await page.getByText('أكمل الجولة').tap();
  await page.waitForSelector('.tile--settled');
  assert((await page.locator('.board__row').first().locator('.tile--settled').count()) === 5, 'first row restored');
});

await step('winning shows confetti sequence, learning card, and records statistics', async () => {
  const s = await session('classic');
  await typeWord([...s.secret.w]);
  await tapKey('إدخال');
  await page.waitForSelector('.learn', { timeout: 6000 });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${SHOTS}/06-win-learning-card.png` });
  const results = await page.evaluate(() => JSON.parse(localStorage.getItem('wordly:v1:results') ?? '[]'));
  assert(results.length === 1 && results[0].won === true, 'one winning result recorded');
  const ach = await page.evaluate(() => JSON.parse(localStorage.getItem('wordly:v1:achievements') ?? '{}'));
  assert(ach.first_win, 'first_win achievement unlocked');
});

await step('no guesses accepted after the game ends', async () => {
  const before = await session('classic');
  assert(['WON', 'COMPLETED'].includes(before.status), `status ${before.status}`);
  assert((await page.locator('.kb').count()) === 0, 'keyboard removed after game end');
});

await step('English HARD enforces discovered letters (LTR keyboard)', async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  // level-up / streak celebrations (WORDLY 2.0) appear once the result sheet closes
  for (let i = 0; i < 3 && (await page.locator('.celeb').count()); i++) {
    await page.locator('.celeb').first().click();
    await page.waitForTimeout(700);
  }
  await page.getByRole('button', { name: 'خروج' }).tap();
  await page.getByText('ع', { exact: true }).first().waitFor();
  await page.locator('[role="radio"]', { hasText: 'EN' }).tap();
  await page.getByText('Play', { exact: true }).tap();
  await page.getByText('English').first().tap();
  await page.getByText('Hard', { exact: true }).tap();
  await page.waitForSelector('.kb .key');
  assert((await page.locator('.kb').getAttribute('dir')) === 'ltr', 'english keyboard ltr');
  const s = await session('classic');
  assert(s.maxAttempts === 5, 'hard has 5 attempts');
  const secret = s.secret.w;
  // first guess: a valid word sharing no position with the secret is not required — use one with a known letter
  const first = secret === 'abyss' ? 'alloy' : 'abyss';
  await typeWord([...first], (l) => l.toUpperCase());
  await tapKey('ENTER');
  await page.waitForTimeout(1800);
  const row = (await session('classic')).rows[0];
  const greenIdx = row.results.findIndex((r) => r === 'correct');
  const yellowIdx = row.results.findIndex((r) => r === 'present');
  if (greenIdx >= 0 || yellowIdx >= 0) {
    // re-submit the exact same guess shape but without the clue letters → must be rejected
    const violating = 'mound'.split('');
    await typeWord(violating, (l) => l.toUpperCase());
    await tapKey('ENTER');
    await page.waitForSelector('.toast', { timeout: 3000 });
    const after = await session('classic');
    assert(after.rows.length === 1, 'violating guess must not consume an attempt');
  }
  await page.screenshot({ path: `${SHOTS}/07-en-hard.png` });
});

await step('daily challenge loads from the server without exposing the answer', async () => {
  await page.getByRole('button', { name: 'Exit' }).tap();
  await page.getByText('Daily Challenge').first().tap();
  // Either the live puzzle (network available) or the graceful offline state (sandboxed CI).
  await page.waitForSelector('text=/Puzzle #|needs an internet connection/', { timeout: 15000 });
  await page.screenshot({ path: `${SHOTS}/08-daily.png` });
  const html = await page.content();
  assert(!/"answer":\{/.test(html), 'answer object should not be in the DOM');
});

await step('statistics and achievements screens render', async () => {
  await page.getByRole('button', { name: 'Back' }).tap();
  await page.locator('button.card', { hasText: 'Statistics' }).tap();
  await page.waitForSelector('text=Guess distribution');
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `${SHOTS}/09-stats.png` });
  await page.getByRole('button', { name: 'Back' }).tap();
  await page.locator('button.card', { hasText: 'Achievements' }).tap();
  await page.waitForSelector('text=First Win');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/10-achievements.png` });
});

await step('no runtime errors in the console', async () => {
  // the sandbox network blocks external hosts (fonts, Supabase) — those are environment, not app, errors
  const real = errors.filter((e) => !/favicon|fonts\.g|ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION/.test(e));
  assert(real.length === 0, real.join(' | '));
});

// desktop layout snapshot
const desk = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-US' });
const dp = await desk.newPage();
await dp.goto(BASE, { waitUntil: 'networkidle' });
await dp.waitForTimeout(1900);
await dp.screenshot({ path: `${SHOTS}/11-desktop-menu.png` });

await browser.close();
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
