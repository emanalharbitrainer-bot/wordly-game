// WORDLY 3.0 end-to-end checks (Playwright, real Chromium, mobile viewport).
// Every server call is intercepted with mocks (the sandbox cannot reach Supabase, and a test run must
// never add fake players to the real league). The SQL itself is tested separately against the database.
// Usage: node tests/e2e/run-v3.mjs [baseUrl] [screenshotDir]
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
    await page?.screenshot({ path: `${SHOTS}/V3-FAIL-${failures.length}.png` }).catch(() => {});
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
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

// ───────── mocks for server writes ─────────
const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const weekEnd = (() => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (7 - d.getUTCDay()));
  return d.toISOString().slice(0, 10);
})();
let member = false;
const calls = [];
const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const board = Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, handle: `h${i}`, name: i === 3 ? 'ضيف الاختبار' : `لاعب ${i + 1}`, avatar: ['🦊', '🐼', '🦉', '🐯', '🐙'][i % 5], color: 'green', points: 120 - i * 11, wins: 5, games: 6, me: i === 3 }));
const leagueMember = () => ({ member: true, me: { handle: 'h3', name: 'ضيف الاختبار', avatar: '🦊', color: 'green', tier: 2 }, week_start: today, week_end: weekEnd, tier: 2, points: 87, board, last: { week_start: '2026-10-25', tier: 1, rank: 2, outcome: 'up', points: 140, reward: true, claimed: false } });
const groupBoard = { code: 'ABC234', name: 'العائلة', owner: true, week_start: today, week_end: weekEnd, board: board.slice(0, 4).map((r, i) => ({ ...r, rank: i + 1, tier: 2 })) };
await page.route('**/rest/v1/rpc/wordly_*', async (route) => {
  const fn = route.request().url().split('/rpc/')[1];
  calls.push(fn);
  switch (fn) {
    case 'wordly_track':
      return route.fulfill({ status: 204, body: '' });
    case 'wordly_league_state':
      return json(route, member ? leagueMember() : { member: false, week_start: today, week_end: weekEnd, points: 18 });
    case 'wordly_league_join':
      member = true;
      return json(route, leagueMember());
    case 'wordly_league_claim':
      return json(route, { ok: true });
    case 'wordly_groups_mine':
      return json(route, calls.includes('wordly_group_create') ? [{ code: 'ABC234', name: 'العائلة', members: 4 }] : []);
    case 'wordly_group_create':
    case 'wordly_group_board':
    case 'wordly_group_join':
      return json(route, groupBoard);
    case 'wordly_daily_set_hard':
      return json(route, { date: today, number: 5, length: 5, max_attempts: 6, guesses: [], patterns: [], status: 'PLAYING', hard: JSON.parse(route.request().postData()).p_hard, archive: false, answer: null });
    case 'wordly_archive_list':
      return json(route, [4, 3, 2, 1].map((n) => ({ date: `2026-11-0${n + 2}`, number: n, status: n === 3 ? 'WON' : 'NEW', attempts: n === 3 ? 4 : 0, hard: false })));
    case 'wordly_daily_state':
      return json(route, { date: today, number: 5, length: 5, max_attempts: 6, guesses: [], patterns: [], status: 'PLAYING', hard: false, archive: false, answer: null });
    case 'wordly_archive_state':
      return json(route, { date: JSON.parse(route.request().postData()).p_date, number: 2, length: 5, max_attempts: 6, guesses: [], patterns: [], status: 'PLAYING', hard: false, archive: true, answer: null });
    default:
      return route.continue();
  }
});

const tapKey = (label) => page.locator(`.kb button[aria-label^="${label}"]`).first().tap();
const typeWord = async (letters) => {
  for (const l of letters) await tapKey(l);
};
const toMenu = async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.modes', { timeout: 6000 });
};

console.log(`WORDLY 3.0 e2e @ ${BASE}`);
await toMenu();

await step('menu shows the new modes and the first-time tutorial card', async () => {
  for (const t of ['الدوري', 'وضع السرعة', 'الباقات', 'الأرشيف']) assert(await page.locator('.mode-tile', { hasText: t }).count(), `missing tile ${t}`);
  assert(await page.locator('.choice--tutorial').count(), 'tutorial card should show for a first-time player');
  assert(!(await page.locator('.season-banner').count()), 'no season banner in November');
  await page.screenshot({ path: `${SHOTS}/v3-01-menu.png` });
});

await step('tutorial: coach explains all three colours, then finishes', async () => {
  await page.locator('.choice--tutorial').tap();
  await page.waitForSelector('.coach');
  assert((await page.locator('.coach').innerText()).includes('حقيبة'), 'coach should suggest the first word');
  await typeWord([...'حقيبة']);
  await tapKey('إدخال');
  await page.waitForTimeout(2200);
  const lines = await page.locator('.coach__line').allInnerTexts();
  assert(lines.length === 3 && lines[0].includes('الأخضر') && lines[1].includes('الأصفر') && lines[2].includes('الرمادي'), `coach lines: ${lines}`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/v3-02-tutorial-coach.png` });
  await typeWord([...'حديقة']);
  await tapKey('إدخال');
  await page.waitForSelector('.sheet', { timeout: 6000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/v3-03-tutorial-done.png` });
  await page.locator('.sheet button', { hasText: 'إلى القائمة' }).first().tap();
  await page.waitForSelector('.modes');
  assert(!(await page.locator('.choice--tutorial').count()), 'tutorial card should disappear after finishing');
  const stats = await page.evaluate(() => localStorage.getItem('wordly:v1:results'));
  assert(!stats || !stats.includes('tutorial'), 'tutorial must not be recorded in statistics');
});

await step('speed mode: clock runs, words chain, result + share card render', async () => {
  await page.locator('.mode-tile', { hasText: 'وضع السرعة' }).tap();
  await page.waitForSelector('.speed-clock');
  const t0 = await page.locator('.speed-clock__time').innerText();
  for (let i = 0; i < 6; i++) {
    await typeWord([...'سيارة']);
    await tapKey('إدخال');
    await page.waitForTimeout(1700);
  }
  await page.waitForTimeout(900);
  const t1 = await page.locator('.speed-clock__time').innerText();
  assert(t0 !== t1, 'clock should be counting down');
  const filled = await page.locator('.board .tile[data-state="absent"], .board .tile[data-state="present"], .board .tile[data-state="correct"]').count();
  await page.screenshot({ path: `${SHOTS}/v3-04-speed.png` });
  await page.locator('.skip-btn').tap();
  await page.waitForSelector('.speed-score', { timeout: 4000 });
  const words = await page.locator('.speed-word').count();
  assert(words === 2, `expected 2 words in the run (1 finished + 1 on the board), got ${words} (filled tiles ${filled})`);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/v3-05-speed-result.png` });
  await page.locator('.sheet button', { hasText: 'شارك' }).first().tap();
  await page.waitForSelector('.share-card img', { timeout: 6000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/v3-06-share-card.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
});

await step('packs: level-locked grid, pack round shows topic and the root hint', async () => {
  await toMenu();
  await page.locator('.mode-tile', { hasText: 'الباقات' }).tap();
  await page.waitForSelector('.pack');
  const total = await page.locator('.pack').count();
  const locked = await page.locator('.pack.is-locked').count();
  assert(total === 4 && locked === 3, `expected 4 packs with 3 locked at level 1, got ${total}/${locked}`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/v3-07-packs.png` });
  await page.locator('.pack:not(.is-locked)').first().tap();
  await page.waitForSelector('.kb .key');
  assert((await page.locator('.game__sub').innerText()).includes('مطبخنا'), 'pack name should show in the header');
  await page.locator('button[aria-label="تلميح"], button[aria-label="Hint"]').first().tap();
  await page.locator('.choice', { hasText: 'الجذر' }).first().tap();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.hint-chip', { timeout: 3000 });
  const chip = await page.locator('.hint-chip').first().innerText();
  assert(/الجذر/.test(chip) && /(\S \S \S|معرّب)/.test(chip), `root hint chip: ${chip}`);
  await page.screenshot({ path: `${SHOTS}/v3-08-pack-root-hint.png` });
});

await step('season preview: Ramadan banner and seasonal pack', async () => {
  await page.goto(`${BASE}/?season=ramadan`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.season-banner', { timeout: 6000 });
  assert((await page.getAttribute('html', 'data-season')) === 'ramadan', 'data-season should be set');
  await page.screenshot({ path: `${SHOTS}/v3-09-season.png` });
  await page.locator('.season-banner__btn').tap();
  await page.waitForSelector('.pack.is-seasonal');
  assert(!(await page.locator('.pack.is-seasonal.is-locked').count()), 'seasonal pack must be open during its season');
  await page.goto(`${BASE}/?season=none`, { waitUntil: 'networkidle' });
});

await step('league: join card → board with zones → reward claim', async () => {
  await toMenu();
  await page.locator('.mode-tile', { hasText: 'الدوري' }).tap();
  await page.waitForSelector('.league-join');
  assert((await page.locator('.league-join').innerText()).includes('١٨'), 'pending points should show');
  await page.locator('.league-join input').fill('ضيف الاختبار');
  await page.locator('.league-join button', { hasText: 'انضم للدوري' }).tap();
  await page.waitForSelector('.lb__row');
  assert((await page.locator('.lb__row.zone-up').count()) === 3, 'top 3 in promotion zone');
  assert((await page.locator('.lb__row.zone-down').count()) === 3, 'bottom 3 in relegation zone (silver, 10 players)');
  assert((await page.locator('.lb__row.is-me').count()) === 1, 'my row highlighted');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/v3-10-league.png` });
  await page.locator('button', { hasText: 'استلم مكافأتك' }).tap();
  await page.waitForSelector('text=درع', { timeout: 3000 });
});

await step('groups: create a group and see its board', async () => {
  await page.getByRole('tab', { name: 'مجموعاتي' }).tap();
  await page.locator('input[placeholder^="اسم المجموعة"]').fill('العائلة');
  await page.locator('button', { hasText: 'إنشاء' }).tap();
  await page.waitForSelector('text=ABC234');
  assert((await page.locator('.lb__row').count()) === 4, 'group board rows');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/v3-11-group.png` });
});

await step('archive: past days listed; opening one starts an archive round', async () => {
  await toMenu();
  await page.locator('.mode-tile', { hasText: 'الأرشيف' }).tap();
  await page.waitForSelector('.archive__day', { timeout: 8000 });
  const n = await page.locator('.archive__day').count();
  assert(n >= 4, `expected at least 4 past challenges, got ${n}`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/v3-12-archive.png` });
  await page.locator('.archive__day button').last().tap();
  await page.waitForSelector('.kb .key');
  assert((await page.locator('.game__mode').innerText()).includes('٢'), 'archive challenge number in header');
  assert(calls.includes('wordly_archive_state'), 'archive state requested');
});

await step('daily: hard-mode switch (server call) before the first guess', async () => {
  await toMenu();
  await page.locator('.choice', { hasText: 'التحدي اليومي' }).first().tap();
  await page.waitForSelector('.hard-row', { timeout: 8000 });
  const sw = page.locator('.hard-row [role="switch"]');
  if ((await sw.getAttribute('disabled')) === null) {
    await sw.tap();
    await page.waitForFunction(() => document.querySelector('.hard-row [role="switch"]')?.getAttribute('aria-checked') === 'true', null, { timeout: 4000 });
    assert(calls.includes('wordly_daily_set_hard'), 'set_hard called');
  }
  await page.screenshot({ path: `${SHOTS}/v3-13-daily-hard.png` });
});

await step('no runtime errors in the console', async () => {
  assert(errors.length === 0, `console errors: ${errors.slice(0, 3).join(' | ')}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
await browser.close();
process.exit(failures.length ? 1 : 0);
