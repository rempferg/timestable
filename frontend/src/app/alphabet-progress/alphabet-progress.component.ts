import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';

import { AlphabetProgressService } from '../alphabet-progress.service';
import { COLUMN_LETTERS, TILE_COUNT, baseIndex, computeOffsetWeights } from '../alphabet-scoring';

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
export class AlphabetProgressComponent {
  readonly childIdObfuscated = input<string | null>(null);
  readonly preview = input(false);

  private readonly progressService = inject(AlphabetProgressService);

  readonly letters = COLUMN_LETTERS;
  readonly loadState = this.progressService.loadState;

  // One column per answered letter, each with 26 boxes ordered by offset from
  // the most negative at the top to the largest at the bottom. The range comes
  // from the letter's base letter, so the correct box (offset 0) sits at the
  // same height for 'A' and 'Ä', for 'O' and 'Ö', and so on.
  readonly columns = computed<Box[][]>(() => {
    const weights = computeOffsetWeights(this.progressService.answers());
    return COLUMN_LETTERS.map((letter) => this.buildColumn(letter, weights.get(letter)));
  });

  constructor() {
    effect(() => {
      const childId = this.childIdObfuscated();
      if (childId) {
        this.progressService.ensureLoaded(childId);
      }
    });
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
