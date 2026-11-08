import type { AnswerEntry, GuessRow, Lang, LetterResult } from '../../types';

/**
 * Guided first round. The secret is fixed and the suggested first guess was picked so that a
 * single row shows all three colors (green, yellow and gray) — the coach then explains them.
 */
export const TUTORIAL: Readonly<Record<Lang, { secret: AnswerEntry; suggest: string }>> = {
  ar: {
    secret: { w: 'حديقة', d: 'حديقة', c: 'أماكن', m: 'أرض فيها أشجار وأزهار يتنزه فيها الناس', p: 'حَدِيقَة', e: 'نتنزه في الحديقةِ كل جمعة.', t: 'garden', r: 'ح د ق' },
    suggest: 'حقيبة',
  },
  en: {
    secret: { w: 'crane', d: 'crane', c: 'Animals', m: 'A tall bird with long legs; also a lifting machine', p: '/kreɪn/', e: 'A crane stood in the shallow water.', t: 'رافعة / طائر الكركي' },
    suggest: 'cabin',
  },
};

export type CoachStep =
  | { kind: 'type'; suggest: string }
  | { kind: 'colors'; seen: LetterResult[] }
  | { kind: 'use'; }
  | { kind: 'won' }
  | { kind: 'lost' };

/** What the coach says given the rows played so far and the round status. */
export function coachStep(rows: readonly GuessRow[], status: string, lang: Lang): CoachStep {
  if (status === 'WON') return { kind: 'won' };
  if (status === 'LOST') return { kind: 'lost' };
  if (rows.length === 0) return { kind: 'type', suggest: TUTORIAL[lang].suggest };
  if (rows.length === 1) {
    const order: LetterResult[] = ['correct', 'present', 'absent'];
    return { kind: 'colors', seen: order.filter((r) => rows[0].results.includes(r)) };
  }
  return { kind: 'use' };
}
