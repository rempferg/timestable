import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
  viewChild
} from '@angular/core';

import { API_BASE_URL } from '../api.config';

@Component({
  selector: 'app-word-list',
  imports: [],
  templateUrl: './word-list.component.html',
  styleUrl: './word-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.full-page]': '!preview()'
  }
})
export class WordListComponent {
  private readonly injector = inject(Injector);

  readonly preview = input(false);
  readonly childIdObfuscated = input<string | null>(null);
  readonly words = signal<Word[]>([]);
  readonly sentenceBoxes = signal<SentenceBox[]>([{ words: [], correctionActive: false, saved: false }]);
  readonly sentenceBoxesRegion = viewChild<ElementRef<HTMLDivElement>>('sentenceBoxesRegion');
  readonly draggedBoxIndex = signal<number | null>(null);
  readonly draggedWordIndex = signal<number | null>(null);
  readonly sentenceDropIndex = signal<number | null>(null);
  readonly loadState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly displayedWords = computed(() =>
    this.preview() ? this.words().slice(0, 24) : this.words()
  );

  constructor() {
    void this.loadWords();
  }

  boxState(box: SentenceBox): SentenceState {
    if (box.saved) {
      return 'submitted';
    }
    if (box.correctionActive) {
      return 'correcting';
    }
    return box.words.length === 0 ? 'empty' : 'assembling';
  }

  addToSentence(word: Word): void {
    this.sentenceBoxes.update((boxes) => {
      const lastIndex = boxes.length - 1;
      return boxes.map((box, i) =>
        i === lastIndex ? { ...box, words: [...box.words, { word, status: 'unset' }] } : box
      );
    });
  }

  onPrimaryButtonClick(boxIndex: number): void {
    const box = this.sentenceBoxes()[boxIndex];
    if (!box) {
      return;
    }

    const state = this.boxState(box);
    if (state === 'assembling') {
      this.lockBox(boxIndex);
    } else if (state === 'correcting') {
      void this.saveBoxResults(boxIndex, box);
    }
  }

  private lockBox(boxIndex: number): void {
    this.sentenceBoxes.update((boxes) => {
      const updated = boxes.map((current, i) =>
        i === boxIndex
          ? {
              ...current,
              words: current.words.map((item) => ({ ...item, status: 'correct' as const })),
              correctionActive: true
            }
          : current
      );

      if (boxIndex === updated.length - 1) {
        updated.push({ words: [], correctionActive: false, saved: false });
        afterNextRender(() => this.scrollSentenceBoxesToBottom(), { injector: this.injector });
      }

      return updated;
    });
  }

  private async saveBoxResults(boxIndex: number, box: SentenceBox): Promise<void> {
    const childId = this.childIdObfuscated();
    if (!childId) {
      return;
    }

    this.sentenceBoxes.update((boxes) =>
      boxes.map((current, i) => (i === boxIndex ? { ...current, saved: true } : current))
    );

    try {
      const response = await fetch(`${API_BASE_URL}/words/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          child_id_obfuscated: childId,
          answers: box.words.map((item) => ({
            word_id: item.word.id,
            correct: item.status === 'correct'
          }))
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to store word answers: ${response.status}`);
      }

      await this.fetchWords();
    } catch (error) {
      console.error('Failed to store word answers', error);
      this.sentenceBoxes.update((boxes) =>
        boxes.map((current, i) => (i === boxIndex ? { ...current, saved: false } : current))
      );
    }
  }

  private scrollSentenceBoxesToBottom(): void {
    const element = this.sentenceBoxesRegion()?.nativeElement;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }

  toggleWordStatus(boxIndex: number, wordIndex: number): void {
    this.sentenceBoxes.update((boxes) =>
      boxes.map((box, i) =>
        i !== boxIndex
          ? box
          : {
              ...box,
              words: box.words.map((item, j) =>
                j === wordIndex
                  ? { ...item, status: item.status === 'correct' ? 'incorrect' : 'correct' }
                  : item
              )
            }
      )
    );
  }

  displaySentenceWord(word: string, index: number): string {
    if (index === 0) {
      return word.charAt(0).toLocaleUpperCase('de-DE') + word.slice(1);
    }

    return word;
  }

  startSentenceDrag(boxIndex: number, wordIndex: number, event: DragEvent): void {
    const box = this.sentenceBoxes()[boxIndex];
    if (!box || this.boxState(box) === 'correcting') {
      event.preventDefault();
      return;
    }
    this.draggedBoxIndex.set(boxIndex);
    this.draggedWordIndex.set(wordIndex);
    this.sentenceDropIndex.set(null);
    event.dataTransfer?.setData('text/plain', String(wordIndex));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  dropSentenceWord(boxIndex: number, event: DragEvent, targetIndex = this.sentenceDropIndex()): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.draggedBoxIndex() !== boxIndex) {
      return;
    }
    this.moveSentenceWord(boxIndex, targetIndex);
  }

  endSentenceDrag(boxIndex: number): void {
    if (this.draggedBoxIndex() !== boxIndex) {
      this.clearSentenceDragState();
      return;
    }

    const targetIndex = this.sentenceDropIndex();
    if (targetIndex === null) {
      this.removeDraggedSentenceWord(boxIndex);
      return;
    }

    this.moveSentenceWord(boxIndex, targetIndex);
  }

  private moveSentenceWord(boxIndex: number, targetIndex: number | null): void {
    const sourceIndex = this.draggedWordIndex();
    if (sourceIndex === null || targetIndex === null || sourceIndex === targetIndex) {
      this.clearSentenceDragState();
      return;
    }

    this.sentenceBoxes.update((boxes) =>
      boxes.map((box, i) => {
        if (i !== boxIndex) {
          return box;
        }
        const reordered = [...box.words];
        const [movedWord] = reordered.splice(sourceIndex, 1);
        const insertionIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
        reordered.splice(insertionIndex, 0, movedWord);
        return { ...box, words: reordered };
      })
    );
    this.clearSentenceDragState();
  }

  private clearSentenceDragState(): void {
    this.draggedBoxIndex.set(null);
    this.draggedWordIndex.set(null);
    this.sentenceDropIndex.set(null);
  }

  private removeDraggedSentenceWord(boxIndex: number): void {
    const sourceIndex = this.draggedWordIndex();
    if (sourceIndex !== null) {
      this.sentenceBoxes.update((boxes) =>
        boxes.map((box, i) =>
          i === boxIndex
            ? { ...box, words: box.words.filter((_, index) => index !== sourceIndex) }
            : box
        )
      );
    }
    this.clearSentenceDragState();
  }

  setSentenceDropIndex(boxIndex: number, wordIndex: number, event: DragEvent): void {
    event.preventDefault();
    if (this.draggedBoxIndex() !== boxIndex) {
      return;
    }
    if (this.draggedWordIndex() !== wordIndex) {
      this.sentenceDropIndex.set(wordIndex);
    }
  }

  setEndDropIndexWhenOverSentenceContainer(boxIndex: number, event: DragEvent): void {
    event.preventDefault();
    if (this.draggedBoxIndex() !== boxIndex) {
      return;
    }
    if (event.target === event.currentTarget) {
      this.sentenceDropIndex.set(this.sentenceBoxes()[boxIndex].words.length);
    }
  }

  clearSentenceDropIndexWhenLeaving(boxIndex: number, event: DragEvent): void {
    if (this.draggedBoxIndex() !== boxIndex) {
      return;
    }

    const container = event.currentTarget;
    const nextTarget = event.relatedTarget;
    if (
      container instanceof Node &&
      nextTarget instanceof Node &&
      container.contains(nextTarget)
    ) {
      return;
    }

    this.sentenceDropIndex.set(null);
  }

  private async loadWords(): Promise<void> {
    try {
      await this.fetchWords();
      this.loadState.set('ready');
    } catch (error) {
      console.error('Failed to load words', error);
      this.loadState.set('error');
    }
  }

  private async fetchWords(): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/words`);
    if (!response.ok) {
      throw new Error(`Failed to fetch words: ${response.status}`);
    }

    this.words.set((await response.json()) as Word[]);
  }
}

type Word = {
  id: number;
  word: string;
  frequency: number | null;
};

type SpellStatus = 'unset' | 'correct' | 'incorrect';

type SentenceItem = {
  word: Word;
  status: SpellStatus;
};

type SentenceState = 'empty' | 'assembling' | 'correcting' | 'submitted';

type SentenceBox = {
  words: SentenceItem[];
  correctionActive: boolean;
  saved: boolean;
};