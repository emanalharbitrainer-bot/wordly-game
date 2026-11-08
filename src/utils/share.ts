import type { GameSession } from '../core/game/game-state';
import type { LetterResult } from '../types';

const EMOJI: Record<LetterResult, string> = { correct: '🟩', present: '🟨', absent: '⬛' };
const EMOJI_CB: Record<LetterResult, string> = { correct: '🟧', present: '🟦', absent: '⬛' };

/** Builds a spoiler-free result: emoji grid only, the word is never included. */
export function buildShareText(s: GameSession, colorBlind = false, link = ''): string {
  const E = colorBlind ? EMOJI_CB : EMOJI;
  const score = s.status === 'WON' || (s.status === 'COMPLETED' && s.rows.at(-1)?.results.every((r) => r === 'correct')) ? s.rows.length : 'X';
  const star = s.hard ? '*' : '';
  const title =
    s.mode === 'daily' || s.mode === 'archive'
      ? `WORDLY ${s.lang === 'ar' ? 'عربي' : 'EN'} #${s.dailyNumber ?? ''} ${score}/${s.maxAttempts}${star}`
      : `WORDLY ${s.lang === 'ar' ? 'عربي' : 'EN'} · ${s.mode === 'custom' ? `AI ${s.length}` : s.difficulty} ${score}/${s.maxAttempts}`;
  const grid = s.rows.map((r) => r.results.map((x) => E[x]).join('')).join('\n');
  return `${title}\n\n${grid}${link ? `\n\n${link}` : ''}`;
}

export async function shareText(text: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      await navigator.share({ text });
      return 'shared';
    }
  } catch {
    /* user cancelled — fall back to clipboard */
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
