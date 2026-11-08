/**
 * Seasonal events. Hijri dates come from the browser's built-in Umm al-Qura calendar, so there
 * is no date table to maintain. If the browser cannot compute it, the game simply has no season.
 */
export type SeasonId = 'ramadan' | 'eid-fitr' | 'eid-adha' | 'founding' | 'national';

export interface Season {
  id: SeasonId;
  ar: string;
  en: string;
  greetingAr: string;
  greetingEn: string;
  emoji: string;
  /** Seasonal word pack unlocked for everyone while the season runs. */
  packId: string;
}

export const SEASONS: Readonly<Record<SeasonId, Season>> = {
  ramadan: { id: 'ramadan', ar: 'رمضان', en: 'Ramadan', greetingAr: 'رمضان كريم 🌙', greetingEn: 'Ramadan Kareem 🌙', emoji: '🌙', packId: 'ar-ramadan' },
  'eid-fitr': { id: 'eid-fitr', ar: 'عيد الفطر', en: 'Eid al-Fitr', greetingAr: 'عيدكم مبارك 🎉', greetingEn: 'Eid Mubarak 🎉', emoji: '🎉', packId: 'ar-ramadan' },
  'eid-adha': { id: 'eid-adha', ar: 'عيد الأضحى', en: 'Eid al-Adha', greetingAr: 'عيد أضحى مبارك 🐑', greetingEn: 'Eid Mubarak 🐑', emoji: '🕋', packId: 'ar-ramadan' },
  founding: { id: 'founding', ar: 'يوم التأسيس', en: 'Founding Day', greetingAr: 'يوم بدينا 🏰', greetingEn: 'Happy Founding Day 🏰', emoji: '🏰', packId: 'ar-national' },
  national: { id: 'national', ar: 'اليوم الوطني', en: 'National Day', greetingAr: 'همة حتى القمة 💚', greetingEn: 'Happy National Day 💚', emoji: '💚', packId: 'ar-national' },
};

export const SEASON_IDS = Object.keys(SEASONS) as SeasonId[];

let hijriFmt: Intl.DateTimeFormat | null | undefined;
let gregFmt: Intl.DateTimeFormat | undefined;

/** Hijri month/day (Umm al-Qura) of a moment in Riyadh, or null when unsupported. */
export function hijriOf(at: Date): { month: number; day: number } | null {
  if (hijriFmt === undefined) {
    try {
      hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { timeZone: 'Asia/Riyadh', month: 'numeric', day: 'numeric' });
      if (hijriFmt.resolvedOptions().calendar !== 'islamic-umalqura') hijriFmt = null;
    } catch {
      hijriFmt = null;
    }
  }
  if (!hijriFmt) return null;
  const parts = hijriFmt.formatToParts(at);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  return Number.isFinite(month) && Number.isFinite(day) ? { month, day } : null;
}

function gregorianOf(at: Date): { month: number; day: number } {
  gregFmt ??= new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', month: 'numeric', day: 'numeric' });
  const parts = gregFmt.formatToParts(at);
  return { month: Number(parts.find((p) => p.type === 'month')?.value), day: Number(parts.find((p) => p.type === 'day')?.value) };
}

/** The season running at `at` (Riyadh time), if any. */
export function seasonAt(at: Date = new Date()): SeasonId | null {
  const g = gregorianOf(at);
  if (g.month === 2 && g.day >= 20 && g.day <= 23) return 'founding';
  if (g.month === 9 && g.day >= 20 && g.day <= 25) return 'national';
  const h = hijriOf(at);
  if (!h) return null;
  if (h.month === 9) return 'ramadan';
  if (h.month === 10 && h.day <= 3) return 'eid-fitr';
  if (h.month === 12 && h.day >= 9 && h.day <= 13) return 'eid-adha';
  return null;
}

/** Active season, with a `?season=<id>` preview override (kept for the browser session). */
export function activeSeason(at: Date = new Date()): Season | null {
  try {
    const q = new URL(location.href).searchParams.get('season');
    if (q !== null) sessionStorage.setItem('wordly:season', q);
    const o = sessionStorage.getItem('wordly:season');
    if (o === 'none') return null;
    if (o && o in SEASONS) return SEASONS[o as SeasonId];
  } catch {
    /* no URL / storage (tests, privacy mode) */
  }
  const id = seasonAt(at);
  return id ? SEASONS[id] : null;
}
