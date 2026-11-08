/** Speed mode: solve as many words as possible in two minutes. Pure helpers (UI-agnostic). */
export const SPEED_MS = 120_000;
export const SPEED_XP_PER_WORD = 4;
export const SPEED_ATTEMPTS = 6;
/** Pause between two words so the last row's flip is visible. */
export const SPEED_NEXT_DELAY_MS = 650;

export interface SpeedWord {
  w: string;
  d: string;
  won: boolean;
}

export interface SpeedRun {
  lang: 'ar' | 'en';
  startedAt: number;
  endsAt: number;
  words: SpeedWord[];
  over: boolean;
}

export const solvedCount = (run: Pick<SpeedRun, 'words'>) => run.words.filter((x) => x.won).length;

export const remainingMs = (run: Pick<SpeedRun, 'endsAt'>, now: number = Date.now()) => Math.max(0, run.endsAt - now);

export function speedXp(run: Pick<SpeedRun, 'words'>): number {
  return solvedCount(run) * SPEED_XP_PER_WORD;
}

export interface SpeedRecord {
  best: Record<'ar' | 'en', number>;
  runs: number;
  solved: number;
}

export const emptySpeedRecord = (): SpeedRecord => ({ best: { ar: 0, en: 0 }, runs: 0, solved: 0 });

export function isSpeedRecord(v: unknown): v is SpeedRecord {
  const o = v as SpeedRecord;
  return typeof o === 'object' && o !== null && typeof o.runs === 'number' && typeof o.best?.ar === 'number' && typeof o.best?.en === 'number';
}

/** Folds a finished run into the record; `isBest` is true when it beats the previous best. */
export function addRun(rec: SpeedRecord, run: SpeedRun): { record: SpeedRecord; isBest: boolean } {
  const n = solvedCount(run);
  const isBest = n > rec.best[run.lang];
  return { record: { best: { ...rec.best, [run.lang]: Math.max(rec.best[run.lang], n) }, runs: rec.runs + 1, solved: rec.solved + n }, isBest };
}
