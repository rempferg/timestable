import { ChangeDetectionStrategy, Component, OnInit, computed, input, signal } from '@angular/core';

import { API_BASE_URL } from '../api.config';

const BASE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// The x axis: every base letter followed directly by the umlauts and the sharp
// s that are answered through it. A column's vertical layout follows its base
// letter, so offset 0 sits at the same height as for that letter.
const COLUMN_LETTERS = [
  'A', 'Ä', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N',
  'O', 'Ö', 'P', 'Q', 'R', 'S', 'ß', 'T', 'U', 'Ü', 'V', 'W', 'X', 'Y', 'Z'
];

const BASE_LETTER_BY_TARGET: Record<string, string> = {
  'Ä': 'A',
  'Ö': 'O',
  'Ü': 'U',
  'ß': 'S'
};

const TILE_COUNT = BASE_LETTERS.length;
const HALF_LIFE_DAYS = 1.5;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type Answer = {
  asked_letter: string;
  clicked_offset: number;
  answered_at: string;
};

type Box = {
  offset: number;
  distance: number;
  weight: number;
};

@Component({
  selector: 'app-alphabet-progress',
  imports: [],
  templateUrl: './alphabet-progress.component.html',
  styleUrl: './alphabet-progress.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-preview]': 'preview()'
  }
})
export class AlphabetProgressComponent implements OnInit {
  readonly childIdObfuscated = input<string | null>(null);
  readonly preview = input(false);

  readonly letters = COLUMN_LETTERS;
  readonly loadState = signal<'loading' | 'ready' | 'error'>('loading');

  private readonly weights = signal<Map<string, Map<number, number>>>(new Map());

  // One column per answered letter, each with 26 boxes ordered by offset from
  // the most negative at the top to the largest at the bottom. The range comes
  // from the letter's base letter, so the correct box (offset 0) sits at the
  // same height for 'A' and 'Ä', for 'O' and 'Ö', and so on.
  readonly columns = computed<Box[][]>(() => {
    const weights = this.weights();
    return COLUMN_LETTERS.map((letter) => this.buildColumn(letter, weights.get(letter)));
  });

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const childId = this.childIdObfuscated();
    if (!childId) {
      this.loadState.set('ready');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/alphabet/progress/${childId}`);
      if (!response.ok) {
        throw new Error(`Failed to load alphabet progress: ${response.status}`);
      }
      const answers = (await response.json()) as Answer[];
      this.weights.set(this.computeWeights(answers));
      this.loadState.set('ready');
    } catch (error) {
      console.error('Failed to load alphabet progress', error);
      this.loadState.set('error');
    }
  }

  // Exponential decay with a 1.5 day half life, normalized per asked letter so
  // that a letter's boxes together carry a weight of 1.
  private computeWeights(answers: Answer[]): Map<string, Map<number, number>> {
    const now = Date.now();
    const decayed = new Map<string, Map<number, number>>();
    const totals = new Map<string, number>();

    for (const answer of answers) {
      const ageDays = Math.max(0, (now - Date.parse(answer.answered_at)) / ONE_DAY_MS);
      const weight = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
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

  private buildColumn(letter: string, byOffset?: Map<number, number>): Box[] {
    const minOffset = -baseIndex(letter);
    const boxes: Box[] = [];
    for (let row = 0; row < TILE_COUNT; row++) {
      const offset = minOffset + row;
      boxes.push({
        offset,
        distance: Math.abs(offset),
        weight: byOffset?.get(offset) ?? 0
      });
    }
    return boxes;
  }

  boxClass(box: Box): string {
    if (box.distance === 0) {
      return 'is-hit';
    }
    if (box.distance === 1) {
      return 'is-near';
    }
    if (box.distance === 2) {
      return 'is-far';
    }
    return 'is-past';
  }
}

function baseIndex(letter: string): number {
  const baseLetter = BASE_LETTER_BY_TARGET[letter] ?? letter;
  return BASE_LETTERS.indexOf(baseLetter);
}
