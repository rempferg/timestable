import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  input,
  signal
} from '@angular/core';

import { API_BASE_URL } from '../api.config';

const BASE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// The row only shows the 26 base letters. Umlauts and the sharp s are practiced
// through their base tile (a German dictionary ordering) but shown as themselves.
const TARGET_LETTERS = [...BASE_LETTERS, 'Ä', 'Ö', 'Ü', 'ß'];

const BASE_LETTER_BY_TARGET: Record<string, string> = {
  'Ä': 'A',
  'Ö': 'O',
  'Ü': 'U',
  'ß': 'S'
};

type Phase = 'asking' | 'answered';

@Component({
  selector: 'app-alphabet-game',
  imports: [],
  templateUrl: './alphabet-game.component.html',
  styleUrl: './alphabet-game.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-preview]': 'preview()',
    '(document:click)': 'onDocumentClick($event)'
  }
})
export class AlphabetGameComponent implements OnInit {
  readonly childIdObfuscated = input<string | null>(null);
  readonly preview = input(false);

  readonly letters = BASE_LETTERS;
  readonly target = signal('A');
  readonly phase = signal<Phase>('asking');
  readonly clickedIndex = signal<number | null>(null);

  readonly correctIndex = computed(() => baseIndex(this.target()));
  readonly clickedOffset = computed(() => {
    const clicked = this.clickedIndex();
    return clicked === null ? null : clicked - this.correctIndex();
  });
  readonly distance = computed(() => {
    const offset = this.clickedOffset();
    return offset === null ? null : Math.abs(offset);
  });

  readonly hint = computed(() => {
    if (this.phase() !== 'answered') {
      return 'Klicke den richtigen Buchstaben an.';
    }
    if (this.distance() === 0) {
      return 'Richtig! Klicke, um weiterzumachen.';
    }
    return 'Daneben. Die grüne Kachel war richtig. Klicke, um weiterzumachen.';
  });

  readonly announcement = computed(() => {
    if (this.phase() !== 'answered') {
      return `Buchstabe ${this.target()}`;
    }
    const offset = this.clickedOffset() ?? 0;
    if (offset === 0) {
      return `${this.target()} – richtig`;
    }
    const direction = offset > 0 ? 'rechts' : 'links';
    return `${this.target()} – ${Math.abs(offset)} ${direction}`;
  });

  private displayedAtMs = 0;

  ngOnInit(): void {
    if (this.preview()) {
      this.target.set('K');
      this.clickedIndex.set(this.correctIndex() + 3);
      this.phase.set('answered');
      return;
    }
    this.startRound();
  }

  startRound(): void {
    this.target.set(this.pickTarget());
    this.clickedIndex.set(null);
    this.phase.set('asking');
    this.displayedAtMs = nowMs();
  }

  onTileClick(index: number, event: Event): void {
    event.stopPropagation();
    if (this.preview()) {
      return;
    }
    if (this.phase() === 'answered') {
      this.startRound();
      return;
    }
    this.answer(index);
  }

  onDocumentClick(event: Event): void {
    if (this.preview() || this.phase() !== 'answered') {
      return;
    }
    const target = event.target;
    const element = target instanceof Element ? target : null;
    if (element?.closest('.menubar')) {
      return;
    }
    this.startRound();
  }

  tileClass(index: number): string {
    if (this.phase() !== 'answered') {
      return '';
    }
    if (index === this.correctIndex()) {
      return 'is-correct';
    }
    if (index === this.clickedIndex()) {
      return `is-offset-${Math.min(this.distance() ?? 0, 3)}`;
    }
    return '';
  }

  private answer(index: number): void {
    this.clickedIndex.set(index);
    this.phase.set('answered');
    const offset = index - this.correctIndex();
    const timeToClickMs = Math.max(0, Math.round(nowMs() - this.displayedAtMs));
    void this.storeAnswer(this.target(), offset, timeToClickMs);
  }

  private async storeAnswer(
    askedLetter: string,
    clickedOffset: number,
    timeToClickMs: number
  ): Promise<void> {
    const childId = this.childIdObfuscated();
    if (!childId) {
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/alphabet/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          child_id_obfuscated: childId,
          asked_letter: askedLetter,
          clicked_offset: clickedOffset,
          time_to_click_ms: timeToClickMs
        })
      });
      if (!response.ok) {
        throw new Error(`Failed to store alphabet answer: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to store alphabet answer', error);
    }
  }

  private pickTarget(): string {
    const previous = this.target();
    const candidates = TARGET_LETTERS.filter((letter) => letter !== previous);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
}

function baseIndex(targetLetter: string): number {
  const baseLetter = BASE_LETTER_BY_TARGET[targetLetter] ?? targetLetter;
  return BASE_LETTERS.indexOf(baseLetter);
}

function nowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
