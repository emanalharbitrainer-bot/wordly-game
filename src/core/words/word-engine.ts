import type { AnswerEntry, Difficulty, Lang } from '../../types';

/** Shape of public/dictionaries/{lang}.json produced by scripts/build_dictionaries.py */
export interface DictionaryFile {
  version: number;
  lang: Lang;
  length: number;
  source: string;
  guesses: string[];
  answers: Record<Difficulty, AnswerEntry[]>;
}

/**
 * Immutable in-memory dictionary for one language.
 * Valid guesses and secret answers are kept separate: every answer is a valid guess,
 * but most valid guesses are never chosen as answers.
 */
export class WordDictionary {
  readonly lang: Lang;
  readonly length: number;
  readonly source: string;
  private readonly guessSet: Set<string>;
  private readonly answerPools: Record<Difficulty, readonly AnswerEntry[]>;
  private readonly answerIndex: Map<string, AnswerEntry>;

  constructor(file: DictionaryFile) {
    if (!file || !Array.isArray(file.guesses) || !file.answers) throw new Error('Invalid dictionary file');
    this.lang = file.lang;
    this.length = file.length;
    this.source = file.source;
    this.guessSet = new Set(file.guesses);
    this.answerPools = file.answers;
    this.answerIndex = new Map();
    for (const pool of Object.values(file.answers)) {
      for (const a of pool) {
        this.answerIndex.set(a.w, a);
        this.guessSet.add(a.w);
      }
    }
  }

  /** Adds a word that must always be accepted (e.g. the secret of an AI-generated challenge). */
  addGuess(normalizedWord: string): void {
    this.guessSet.add(normalizedWord);
  }

  isValidGuess(normalizedWord: string): boolean {
    return this.guessSet.has(normalizedWord);
  }

  answers(level: Difficulty): readonly AnswerEntry[] {
    return this.answerPools[level] ?? [];
  }

  findAnswer(normalizedWord: string): AnswerEntry | undefined {
    return this.answerIndex.get(normalizedWord);
  }

  get guessCount(): number {
    return this.guessSet.size;
  }
}

type Loader = (lang: Lang, length: number) => Promise<DictionaryFile>;

/** Word lengths available for custom (AI) challenges. 5 is the main curated dictionary. */
export const SUPPORTED_LENGTHS: readonly number[] = [3, 4, 5, 6, 7, 8];

export function dictionaryPath(lang: Lang, length: number): string {
  return length === 5 ? `/dictionaries/${lang}.json` : `/dictionaries/${lang}-${length}.json`;
}

const defaultLoader: Loader = async (lang, length) => {
  const res = await fetch(dictionaryPath(lang, length), { cache: 'force-cache' });
  if (!res.ok) throw new Error(`Failed to load ${lang} dictionary (${res.status})`);
  return (await res.json()) as DictionaryFile;
};

/** Lazily loads each language/length dictionary once (only when it is actually needed). */
export class WordEngine {
  private cache = new Map<string, Promise<WordDictionary>>();
  constructor(private readonly loader: Loader = defaultLoader) {}

  load(lang: Lang, length = 5): Promise<WordDictionary> {
    if (!SUPPORTED_LENGTHS.includes(length)) return Promise.reject(new Error(`Unsupported word length ${length}`));
    const key = `${lang}:${length}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.loader(lang, length).then((f) => new WordDictionary(f));
      p.catch(() => this.cache.delete(key));
      this.cache.set(key, p);
    }
    return p;
  }
}

export const wordEngine = new WordEngine();
