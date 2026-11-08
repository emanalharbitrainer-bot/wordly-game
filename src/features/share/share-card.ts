import { challengeLink } from '../../core/custom/share-code';
import type { GameSession } from '../../core/game/game-state';
import type { SpeedRun } from '../../core/speed/speed';
import type { Lang, LetterResult } from '../../types';

/**
 * Result card rendered to a PNG in the browser (1080 × 1350, portrait — fits stories and chats).
 * It carries the board pattern, score and streak but NEVER the answer.
 */
const W = 1080;
const H = 1350;
const ORIGIN = () => (typeof location !== 'undefined' ? location.origin : 'https://wordly-ar.vercel.app');

const TILE: Record<'normal' | 'cb', Record<LetterResult, string>> = {
  normal: { correct: '#2f9e6e', present: '#d9a62e', absent: '#3a3d46' },
  cb: { correct: '#e8702a', present: '#3d8fd6', absent: '#3a3d46' },
};

/** Link attached to a shared result: opens the same challenge for whoever taps it. */
export function shareLinkFor(s: GameSession | null, speed: SpeedRun | null): string {
  if (speed && (!s || s.mode === 'speed')) return `${ORIGIN()}/?s=${speed.lang}`;
  if (!s) return ORIGIN();
  if (s.mode === 'daily' || s.mode === 'archive') return `${ORIGIN()}/?d=${s.lang}`;
  const a = s.secret ?? s.reveal;
  if (!a || s.mode === 'tutorial') return ORIGIN();
  return challengeLink({
    lang: s.lang,
    length: s.length,
    attempts: s.maxAttempts,
    difficulty: s.difficulty,
    topic: s.topic,
    word: a.w,
    display: a.d,
    category: a.c,
    meaning: a.m,
    translation: a.t,
    pronunciation: a.p,
    example: a.e,
  });
}

export interface CardInput {
  session: GameSession | null;
  speed: SpeedRun | null;
  uiLang: Lang;
  colorBlind: boolean;
  /** e.g. "التحدي اليومي #5" or "Word pack · Kitchen" */
  label: string;
  streak: number;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

const FONT = '"Readex Pro", system-ui, sans-serif';

export async function renderCard(input: CardInput): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unsupported');
  try {
    await Promise.all([document.fonts?.load(`700 64px ${FONT}`), document.fonts?.load(`500 40px ${FONT}`)]);
  } catch {
    /* fall back to system font */
  }
  const ar = input.uiLang === 'ar';
  const palette = TILE[input.colorBlind ? 'cb' : 'normal'];

  // background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#15171d');
  bg.addColorStop(1, '#1f2330');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 260, 40, W / 2, 260, 520);
  glow.addColorStop(0, 'rgba(47,158,110,0.28)');
  glow.addColorStop(1, 'rgba(47,158,110,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // logo + title
  const logo = await loadImage('/apple-touch-icon.png');
  if (logo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, 170, 90, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, W / 2 - 90, 80, 180, 180);
    ctx.restore();
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 72px ${FONT}`;
  ctx.fillText('WORDLY', W / 2, 340);
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = `500 40px ${FONT}`;
  ctx.direction = ar ? 'rtl' : 'ltr';
  ctx.fillText(input.label, W / 2, 400);

  const s = input.session;
  if (input.speed && (!s || s.mode === 'speed')) {
    drawSpeed(ctx, input, palette);
  } else if (s) {
    const won = s.rows.at(-1)?.results.every((r) => r === 'correct') ?? false;
    const score = `${won ? s.rows.length : 'X'}/${s.maxAttempts}${s.hard ? '*' : ''}`;
    ctx.direction = 'ltr';
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 96px ${FONT}`;
    ctx.fillText(score, W / 2, 520);
    // grid
    const n = s.length;
    const gap = 14;
    const size = Math.min(124, Math.floor((W - 200 - gap * (n - 1)) / n));
    const gridW = n * size + (n - 1) * gap;
    const rows = s.rows.length;
    const top = 580 + Math.max(0, (6 - rows) * (size + gap)) / 2;
    s.rows.forEach((row, r) => {
      row.results.forEach((res, c) => {
        const col = s.lang === 'ar' ? n - 1 - c : c; // Arabic reads right-to-left
        const x = (W - gridW) / 2 + col * (size + gap);
        const y = top + r * (size + gap);
        roundRect(ctx, x, y, size, size, 18);
        ctx.fillStyle = palette[res];
        ctx.fill();
      });
    });
  }

  // footer
  ctx.direction = ar ? 'rtl' : 'ltr';
  ctx.font = `600 40px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  if (input.streak > 0) ctx.fillText(`🔥 ${input.streak}`, W / 2, H - 150);
  ctx.font = `500 34px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.direction = 'ltr';
  ctx.fillText(ORIGIN().replace(/^https?:\/\//, ''), W / 2, H - 80);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

function drawSpeed(ctx: CanvasRenderingContext2D, input: CardInput, palette: Record<LetterResult, string>) {
  const run = input.speed!;
  const solved = run.words.filter((w) => w.won).length;
  ctx.direction = 'ltr';
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 220px ${FONT}`;
  ctx.fillText(String(solved), W / 2, 700);
  ctx.font = `500 44px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.direction = input.uiLang === 'ar' ? 'rtl' : 'ltr';
  ctx.fillText(input.uiLang === 'ar' ? 'كلمة في دقيقتين ⚡' : 'words in 2 minutes ⚡', W / 2, 790);
  const dots = run.words.slice(0, 24);
  const d = 46;
  const gap = 14;
  const perRow = 8;
  dots.forEach((w, i) => {
    const r = Math.floor(i / perRow);
    const inRow = Math.min(perRow, dots.length - r * perRow);
    const c = i % perRow;
    const rowW = inRow * d + (inRow - 1) * gap;
    const x = (W - rowW) / 2 + c * (d + gap);
    const y = 860 + r * (d + gap);
    roundRect(ctx, x, y, d, d, 10);
    ctx.fillStyle = w.won ? palette.correct : palette.absent;
    ctx.fill();
  });
}
