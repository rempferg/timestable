// Shared alphabet facts and scoring, used by both the progress plot and the
// letter picker so they agree on what a letter's history means.

export const BASE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export const COLUMN_LETTERS = [
  'A', 'Ä', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N',
  'O', 'Ö', 'P', 'Q', 'R', 'S', 'ß', 'T', 'U', 'Ü', 'V', 'W', 'X', 'Y', 'Z'
];

export const TARGET_LETTERS = [...BASE_LETTERS, 'Ä', 'Ö', 'Ü', 'ß'];

const BASE_LETTER_BY_TARGET: Record<string, string> = {
  'Ä': 'A',
  'Ö': 'O',
  'Ü': 'U',
  'ß': 'S'
};

export const TILE_COUNT = BASE_LETTERS.length;

export type AlphabetAnswer = {
  asked_letter: string;
  clicked_offset: number;
  answered_at: string;
};

export function baseIndex(targetLetter: string): number {
  const baseLetter = BASE_LETTER_BY_TARGET[targetLetter] ?? targetLetter;
  return BASE_LETTERS.indexOf(baseLetter);
}

const HALF_LIFE_DAYS = 1.5;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function decayWeight(answeredAt: string, nowMs: number): number {
  const ageDays = Math.max(0, (nowMs - Date.parse(answeredAt)) / ONE_DAY_MS);
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

// How wrong a single answer is: a hit is 0, the biggest misses are 1.
function errorPenalty(distance: number): number {
  if (distance === 0) {
    return 0;
  }
  if (distance === 1) {
    return 0.4;
  }
  if (distance === 2) {
    return 0.7;
  }
  return 1;
}

// Per asked letter, the share of the recency weight at each clicked offset.
// A letter's offsets add up to 1; this feeds the progress plot's box alpha.
export function computeOffsetWeights(
  answers: AlphabetAnswer[]
): Map<string, Map<number, number>> {
  const now = Date.now();
  const decayed = new Map<string, Map<number, number>>();
  const totals = new Map<string, number>();

  for (const answer of answers) {
    const weight = decayWeight(answer.answered_at, now);
    const byOffset = decayed.get(answer.asked_letter) ?? new Map<number, number>();
    byOffset.set(answer.clicked_offset, (byOffset.get(answer.clicked_offset) ?? 0) + weight);
    decayed.set(answer.asked_letter, byOffset);
    totals.set(answer.asked_letter, (totals.get(answer.asked_letter) ?? 0) + weight);
  }

  const normalized = new Map<string, Map<number, number>>();
  for (const [letter, byOffset] of decayed) {
    const total = totals.get(letter) ?? 0;
    const out = new Map<number, number>();
    if (total > 0) {
      for (const [offset, weight] of byOffset) {
        out.set(offset, Math.min(1, weight / total));
      }
    }
    normalized.set(letter, out);
  }
  return normalized;
}

// Per asked letter, the recency-weighted average of how wrong the answers were,
// in [0, 1]. A letter with no answers is absent from the map.
export function computeBadness(answers: AlphabetAnswer[]): Map<string, number> {
  const now = Date.now();
  const weightedError = new Map<string, number>();
  const totals = new Map<string, number>();

  for (const answer of answers) {
    const weight = decayWeight(answer.answered_at, now);
    const error = errorPenalty(Math.abs(answer.clicked_offset));
    weightedError.set(
      answer.asked_letter,
      (weightedError.get(answer.asked_letter) ?? 0) + weight * error
    );
    totals.set(answer.asked_letter, (totals.get(answer.asked_letter) ?? 0) + weight);
  }

  const badness = new Map<string, number>();
  for (const [letter, error] of weightedError) {
    const total = totals.get(letter) ?? 0;
    if (total > 0) {
      badness.set(letter, Math.min(1, Math.max(0, error / total)));
    }
  }
  return badness;
}
