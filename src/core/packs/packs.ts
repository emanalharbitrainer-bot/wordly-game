import type { AnswerEntry, Lang } from '../../types';
import type { SeasonId } from '../season/season';
import { SEASONS } from '../season/season';
import type { Rng } from '../words/word-selector';

/** Themed word packs. Words live in public/dictionaries/packs-{lang}.json (built + validated). */
export interface PackMeta {
  id: string;
  lang: Lang;
  ar: string;
  en: string;
  icon: string;
  /** Player level that unlocks it (seasonal packs: only while their season runs). */
  level: number;
  seasonal?: boolean;
}

export const PACKS: readonly PackMeta[] = [
  { id: 'ar-kitchen', lang: 'ar', ar: 'مطبخنا', en: 'Our Kitchen', icon: '🍲', level: 1 },
  { id: 'ar-cities', lang: 'ar', ar: 'مدن ومعالم', en: 'Cities & Landmarks', icon: '🏙️', level: 3 },
  { id: 'ar-sport', lang: 'ar', ar: 'رياضة', en: 'Sports', icon: '⚽', level: 5 },
  { id: 'ar-nature', lang: 'ar', ar: 'برّ وبحر', en: 'Land & Sea', icon: '🏜️', level: 8 },
  { id: 'ar-ramadan', lang: 'ar', ar: 'رمضان والعيد', en: 'Ramadan & Eid', icon: '🌙', level: 0, seasonal: true },
  { id: 'ar-national', lang: 'ar', ar: 'وطني', en: 'My Homeland', icon: '💚', level: 0, seasonal: true },
  { id: 'en-kitchen', lang: 'en', ar: 'المطبخ', en: 'Kitchen', icon: '🍝', level: 1 },
  { id: 'en-cities', lang: 'en', ar: 'مدن العالم', en: 'World Cities', icon: '🌍', level: 3 },
  { id: 'en-sports', lang: 'en', ar: 'رياضات', en: 'Sports', icon: '🏉', level: 5 },
  { id: 'en-space', lang: 'en', ar: 'الفضاء والعلوم', en: 'Space & Science', icon: '🚀', level: 8 },
];

export const PACK_SIZE = 12;

export const packById = (id: string) => PACKS.find((p) => p.id === id);

export function isPackUnlocked(p: PackMeta, level: number, season: SeasonId | null): boolean {
  if (p.seasonal) return season !== null && SEASONS[season].packId === p.id;
  return level >= p.level;
}

/** Seasonal packs are listed only while they are open; regular packs always (locked or not). */
export function visiblePacks(lang: Lang, season: SeasonId | null): PackMeta[] {
  return PACKS.filter((p) => p.lang === lang && (!p.seasonal || (season !== null && SEASONS[season].packId === p.id)));
}

/** Next word: unsolved words first, never the word just played, deterministic with a seeded rng. */
export function pickPackWord(entries: readonly AnswerEntry[], solved: readonly string[], last: string | null, rng: Rng = Math.random): AnswerEntry {
  if (!entries.length) throw new Error('Empty pack');
  const done = new Set(solved);
  const notLast = entries.filter((e) => e.w !== last);
  const pool = notLast.filter((e) => !done.has(e.w));
  const candidates = pool.length ? pool : notLast.length ? notLast : entries;
  return candidates[Math.floor(rng() * candidates.length) % candidates.length];
}

export interface PackFile {
  version: number;
  lang: Lang;
  packs: Record<string, AnswerEntry[]>;
}

const cache = new Map<Lang, Promise<PackFile>>();

export function loadPacks(lang: Lang): Promise<PackFile> {
  let p = cache.get(lang);
  if (!p) {
    p = fetch(`/dictionaries/packs-${lang}.json`, { cache: 'force-cache' }).then((r) => {
      if (!r.ok) throw new Error(`packs ${r.status}`);
      return r.json() as Promise<PackFile>;
    });
    p.catch(() => cache.delete(lang));
    cache.set(lang, p);
  }
  return p;
}
