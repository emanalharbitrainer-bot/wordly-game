/**
 * Device performance tier. While the splash plays we sample real frame times; if this device
 * can't hold a smooth frame rate, `data-perf="lite"` switches off purely decorative, always-on
 * animations (floating menu tiles, orb aura, embers, shines). Gameplay feedback is untouched.
 * The result is remembered so the very next launch starts in the right mode.
 */
const KEY = 'wordly:v1:perf';

export function applySavedPerfTier(): void {
  try {
    if (localStorage.getItem(KEY) === 'lite') document.documentElement.dataset.perf = 'lite';
  } catch {
    /* storage unavailable */
  }
}

export function measurePerfTier(durationMs = 1100): void {
  if (typeof requestAnimationFrame === 'undefined') return;
  const frames: number[] = [];
  let last = 0;
  const start = performance.now();
  const tick = (t: number) => {
    if (last) frames.push(t - last);
    last = t;
    if (t - start < durationMs) requestAnimationFrame(tick);
    else finish();
  };
  const finish = () => {
    if (document.visibilityState !== 'visible' || frames.length < 20) return;
    const sorted = [...frames].sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    const lite = p75 > 26; // worse than ~38fps for a quarter of frames
    try {
      localStorage.setItem(KEY, lite ? 'lite' : 'full');
    } catch {
      /* ignore */
    }
    if (lite) document.documentElement.dataset.perf = 'lite';
    else delete document.documentElement.dataset.perf;
  };
  // skip the first moments of boot (font/JS parse) — they are not representative
  setTimeout(() => requestAnimationFrame(tick), 350);
}
