import confettiLib, { type CreateTypes, type Options } from 'canvas-confetti';

/**
 * One shared confetti canvas whose drawing runs in a Web Worker (OffscreenCanvas), so the
 * celebration never competes with the result sheet / UI animations on the main thread.
 * Falls back to the library's main-thread canvas where workers/OffscreenCanvas are missing.
 */
let shared: CreateTypes | null = null;
let layer: HTMLCanvasElement | null = null;

function instance(zIndex: number): CreateTypes {
  if (typeof document === 'undefined') return confettiLib as unknown as CreateTypes;
  if (!shared) {
    layer = document.createElement('canvas');
    layer.setAttribute('aria-hidden', 'true');
    Object.assign(layer.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    document.body.appendChild(layer);
    const canWork = typeof Worker !== 'undefined' && 'transferControlToOffscreen' in layer;
    shared = confettiLib.create(layer, { resize: true, useWorker: canWork, disableForReducedMotion: true });
  }
  if (layer) layer.style.zIndex = String(zIndex);
  return shared;
}

/** Theme colours, read once per theme (getComputedStyle mid-animation forces a full style pass). */
let paletteKey = '';
let palette: string[] = [];
function colors(): string[] {
  const root = document.documentElement;
  const key = `${root.dataset.theme ?? 'system'}|${root.dataset.contrast ?? ''}|${matchMedia('(prefers-color-scheme: dark)').matches}`;
  if (key !== paletteKey) {
    const css = getComputedStyle(root);
    palette = ['--correct', '--present', '--gold', '--accent'].map((v) => css.getPropertyValue(v).trim()).filter(Boolean);
    paletteKey = key;
  }
  return palette;
}

export function themeColors(): string[] {
  return colors();
}

/** Fire one burst on the shared off-thread canvas. */
export function burst(opts: Options & { zIndex?: number }) {
  const { zIndex = 80, ...rest } = opts;
  void instance(zIndex)({ colors: colors(), disableForReducedMotion: true, ...rest });
}

export function resetConfetti() {
  shared?.reset();
}

/**
 * Celebration burst: two angled cannons from the bottom corners, then a soft
 * center shower. Uses the game's own palette so it feels part of the product.
 */
export function celebrate(reduced: boolean) {
  if (reduced) return;
  const base = { ticks: 220, scalar: 0.9, zIndex: 80 };
  burst({ ...base, particleCount: 55, angle: 60, spread: 58, startVelocity: 52, origin: { x: 0, y: 0.95 } });
  burst({ ...base, particleCount: 55, angle: 120, spread: 58, startVelocity: 52, origin: { x: 1, y: 0.95 } });
  setTimeout(() => {
    burst({ ...base, particleCount: 60, spread: 100, startVelocity: 28, gravity: 0.7, origin: { x: 0.5, y: 0.25 }, shapes: ['square', 'circle'] });
  }, 260);
}
