import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import { API_BASE_URL } from '../api.config';

@Component({
  selector: 'app-word-list',
  imports: [],
  templateUrl: './word-list.component.html',
  styleUrl: './word-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WordListComponent {
  readonly preview = input(false);
  readonly words = signal<Word[]>([]);
  readonly sentenceWords = signal<SentenceItem[]>([]);
  readonly correctionActive = signal(false);
  readonly draggedSentenceIndex = signal<number | null>(null);
  readonly sentenceDropIndex = signal<number | null>(null);
  readonly loadState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly displayedWords = computed(() =>
    this.preview() ? this.words().slice(0, 24) : this.words()
  );
  readonly sentenceState = computed<SentenceState>(() => {
    if (this.correctionActive()) {
      return 'correcting';
    }
    return this.sentenceWords().length === 0 ? 'empty' : 'assembling';
  });

  constructor() {
    void this.loadWords();
  }

  addToSentence(word: Word): void {
    if (this.sentenceState() === 'correcting') {
      return;
    }
    this.sentenceWords.update((sentence) => [...sentence, { word, status: 'unset' }]);
  }

  onPrimaryButtonClick(): void {
    if (this.sentenceState() === 'assembling') {
      this.sentenceWords.update((sentence) =>
        sentence.map((item) => ({ ...item, status: 'correct' }))
      );
      this.correctionActive.set(true);
    }
  }

  toggleWordStatus(index: number): void {
    this.sentenceWords.update((sentence) =>
      sentence.map((item, i) =>
        i === index
          ? { ...item, status: item.status === 'correct' ? 'incorrect' : 'correct' }
          : item
      )
    );
  }

  displaySentenceWord(word: string, index: number): string {
    if (index === 0) {
      return word.charAt(0).toLocaleUpperCase('de-DE') + word.slice(1);
    }

    return word;
  }

  startSentenceDrag(index: number, event: DragEvent): void {
    if (this.sentenceState() === 'correcting') {
      event.preventDefault();
      return;
    }
    this.draggedSentenceIndex.set(index);
    this.sentenceDropIndex.set(null);
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  dropSentenceWord(event: DragEvent, targetIndex = this.sentenceDropIndex()): void {
    event.preventDefault();
    event.stopPropagation();
    this.moveSentenceWord(targetIndex);
  }

  endSentenceDrag(): void {
    const targetIndex = this.sentenceDropIndex();
    if (targetIndex === null) {
      this.removeDraggedSentenceWord();
      return;
    }

    this.moveSentenceWord(targetIndex);
  }

  private moveSentenceWord(targetIndex: number | null): void {
    const sourceIndex = this.draggedSentenceIndex();
    if (sourceIndex === null || targetIndex === null || sourceIndex === targetIndex) {
      this.clearSentenceDragState();
      return;
    }

    this.sentenceWords.update((sentence) => {
      const reordered = [...sentence];
      const [movedWord] = reordered.splice(sourceIndex, 1);
      const insertionIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      reordered.splice(insertionIndex, 0, movedWord);
      return reordered;
    });
    this.clearSentenceDragState();
  }

  private clearSentenceDragState(): void {
    this.draggedSentenceIndex.set(null);
    this.sentenceDropIndex.set(null);
  }

  private removeDraggedSentenceWord(): void {
    const sourceIndex = this.draggedSentenceIndex();
    if (sourceIndex !== null) {
      this.sentenceWords.update((sentence) => sentence.filter((_, index) => index !== sourceIndex));
    }
    this.clearSentenceDragState();
  }

  setSentenceDropIndex(index: number, event: DragEvent): void {
    event.preventDefault();
    if (this.draggedSentenceIndex() !== index) {
      this.sentenceDropIndex.set(index);
    }
  }

  setEndDropIndexWhenOverSentenceContainer(event: DragEvent): void {
    event.preventDefault();
    if (event.target === event.currentTarget) {
      this.sentenceDropIndex.set(this.sentenceWords().length);
    }
  }

  clearSentenceDropIndexWhenLeaving(event: DragEvent): void {
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
      const response = await fetch(`${API_BASE_URL}/words`);
      if (!response.ok) {
        throw new Error(`Failed to fetch words: ${response.status}`);
      }

      this.words.set((await response.json()) as Word[]);
      this.loadState.set('ready');
    } catch (error) {
      console.error('Failed to load words', error);
      this.loadState.set('error');
    }
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

type SentenceState = 'empty' | 'assembling' | 'correcting';