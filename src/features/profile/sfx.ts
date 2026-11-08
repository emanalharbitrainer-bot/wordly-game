import { useProfile } from './profile-store';

/**
 * Tiny WebAudio synth for game-feel sounds (no audio files to download). Silent until the first user
 * gesture, respects the sound toggle, and every sound is short and soft.
 */
let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  if (!useProfile.getState().sound) return null;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.06, delay = 0, slide = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, gain = 0.05, freq = 900) {
  const a = ac();
  if (!a) return;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(freq, a.currentTime);
  f.frequency.exponentialRampToValueAtTime(freq * 3, a.currentTime + dur);
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export const sfx = {
  tap: () => tone(660, 0.05, 'triangle', 0.035),
  turn: () => {
    tone(523, 0.12, 'sine', 0.05);
    tone(784, 0.16, 'sine', 0.05, 0.09);
  },
  flip: (i: number) => tone(300 + i * 40, 0.06, 'triangle', 0.03),
  whoosh: (tier: number) => {
    noise(0.35 + tier * 0.04, 0.05 + tier * 0.008, 500);
    tone(180, 0.3, 'sawtooth', 0.012, 0, 260);
  },
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.06, i * 0.09)),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.26, 'sine', 0.05, i * 0.12)),
  level: () => [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.25, 'triangle', 0.05, i * 0.07)),
  pop: () => tone(880, 0.08, 'sine', 0.05, 0, 300),
  count: (n: number) => tone(n > 0 ? 440 : 880, n > 0 ? 0.12 : 0.3, 'square', 0.025),
};
