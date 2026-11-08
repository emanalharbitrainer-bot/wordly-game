/**
 * Splits text into user-perceived characters (grapheme clusters).
 * We never rely on `string.length`, which counts UTF-16 code units and breaks for
 * combining marks, surrogate pairs and some Arabic sequences.
 */
let segmenter: Intl.Segmenter | null | undefined;

function getSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  }
  return segmenter;
}

export function splitGraphemes(text: string): string[] {
  const seg = getSegmenter();
  if (seg) return Array.from(seg.segment(text), (s) => s.segment);
  // Fallback: code points, attaching combining marks to the previous base character.
  const out: string[] = [];
  for (const ch of Array.from(text)) {
    if (/\p{M}/u.test(ch) && out.length) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

export function graphemeLength(text: string): number {
  return splitGraphemes(text).length;
}
