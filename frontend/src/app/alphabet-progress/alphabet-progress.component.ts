import { ChangeDetectionStrategy, Component, OnInit, computed, input, signal } from '@angular/core';

import { API_BASE_URL } from '../api.config';
import {
  AlphabetAnswer,
  COLUMN_LETTERS,
  TILE_COUNT,
  baseIndex,
  computeOffsetWeights
} from '../alphabet-scoring';

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
      const answers = (await response.json()) as AlphabetAnswer[];
      this.weights.set(computeOffsetWeights(answers));
      this.loadState.set('ready');
    } catch (error) {
      console.error('Failed to load alphabet progress', error);
      this.loadState.set('error');
    }
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
