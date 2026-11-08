import type { CustomChallenge } from './custom-challenge';

/**
 * Friend-challenge links: the challenge travels in the URL (`?c=…`) so a friend plays the exact
 * same board. The payload is lightly obfuscated (XOR + base64url) — enough that the word is not
 * readable at a glance in a shared link; it is a game, not a secret vault.
 */
const SALT = [87, 79, 82, 68, 76, 89, 33, 7, 99, 13, 42, 64];
const FIELDS = ['lang', 'length', 'attempts', 'difficulty', 'topic', 'word', 'display', 'category', 'meaning', 'translation', 'pronunciation', 'example'] as const;

function xor(bytes: Uint8Array): Uint8Array {
  return bytes.map((b, i) => b ^ SALT[i % SALT.length] ^ (i * 31) % 251);
}

function toB64Url(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(code: string): Uint8Array {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function encodeChallenge(ch: CustomChallenge): string {
  const compact = FIELDS.map((k) => ch[k] ?? '');
  return toB64Url(xor(new TextEncoder().encode(JSON.stringify(compact))));
}

export function decodeChallenge(code: string): CustomChallenge | null {
  try {
    const arr = JSON.parse(new TextDecoder().decode(xor(fromB64Url(code.trim()))));
    if (!Array.isArray(arr) || arr.length !== FIELDS.length) return null;
    const o = Object.fromEntries(FIELDS.map((k, i) => [k, arr[i]])) as Record<string, unknown>;
    return {
      lang: o.lang === 'en' ? 'en' : 'ar',
      length: Number(o.length),
      attempts: Number(o.attempts),
      difficulty: (['easy', 'normal', 'hard', 'expert'].includes(String(o.difficulty)) ? o.difficulty : 'normal') as CustomChallenge['difficulty'],
      topic: String(o.topic ?? ''),
      word: String(o.word ?? ''),
      display: String(o.display ?? ''),
      category: String(o.category ?? ''),
      meaning: String(o.meaning ?? ''),
      translation: String(o.translation ?? ''),
      pronunciation: String(o.pronunciation ?? ''),
      example: String(o.example ?? ''),
    };
  } catch {
    return null;
  }
}

export function challengeLink(ch: CustomChallenge): string {
  const origin = typeof location !== 'undefined' ? location.origin : 'https://wordly-ar.vercel.app';
  return `${origin}/?c=${encodeChallenge(ch)}`;
}
