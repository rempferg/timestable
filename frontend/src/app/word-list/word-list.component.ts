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
  readonly wordProgress = signal<Map<number, AnswerResult[]>>(new Map());
  readonly sentenceBoxes = signal<SentenceBox[]>([
    { words: [], correctionActive: false, saved: false, saving: false }
  ]);
  readonly sentenceBoxesRegion = viewChild<ElementRef<HTMLDivElement>>('sentenceBoxesRegion');
  readonly draggedBoxIndex = signal<number | null>(null);
  readonly draggedWordIndex = signal<number | null>(null);
  readonly sentenceDropIndex = signal<number | null>(null);
  readonly loadState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly activeInsertBoxIndex = signal<number | null>(null);
  readonly insertQuery = signal('');
  readonly insertInput = viewChild<ElementRef<HTMLInputElement>>('insertInput');
  readonly insertSuggestions = computed(() => {
    const query = this.insertQuery().trim().toLowerCase();
    if (!query) {
      return [];
    }
    return this.words()
      .filter((word) => word.word.toLowerCase().startsWith(query))
      .slice(0, 8);
  });
  readonly sortedWords = computed(() => {
    const groupByWordId = new Map<number, number>();
    for (const word of this.words()) {
      groupByWordId.set(word.id, this.classifyWord(word.id).group);
    }
    return [...this.words()].sort(
      (a, b) => (groupByWordId.get(a.id) ?? 3) - (groupByWordId.get(b.id) ?? 3)
    );
  });
  readonly displayedWords = computed(() =>
    this.preview() ? this.sortedWords().slice(0, 24) : this.sortedWords()
  );
  readonly groupSegments = computed(() => {
    const counts = new Map<number, number>();
    for (const word of this.words()) {
      const group = this.classifyWord(word.id).group;
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }

    const total = this.words().length;
    if (total === 0) {
      return [];
    }

    return [1, 2, 3, 4]
      .map((group) => ({
        group,
        count: counts.get(group) ?? 0,
        color: this.groupBarColors[group]
      }))
      .filter((segment) => segment.count > 0)
      .map((segment) => ({ ...segment, percent: (segment.count / total) * 100 }));
  });

  private readonly groupBarColors: Record<number, string> = {
    1: 'hsl(4 55% 55%)',
    2: 'rgb(255, 208, 90)',
    3: 'rgba(29, 29, 31, 0.15)',
    4: 'rgb(63, 166, 101)'
  };

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
    afterNextRender(() => this.scrollSentenceBoxesToBottom(), { injector: this.injector });
  }

  onSentenceFlowClick(boxIndex: number): void {
    const box = this.sentenceBoxes()[boxIndex];
    if (!box) {
      return;
    }
    const state = this.boxState(box);
    if (state !== 'assembling' && state !== 'empty') {
      return;
    }

    this.activeInsertBoxIndex.set(boxIndex);
    this.insertQuery.set('');
    afterNextRender(() => this.insertInput()?.nativeElement.focus(), { injector: this.injector });
  }

  onInsertQueryChange(event: Event): void {
    this.insertQuery.set((event.target as HTMLInputElement).value);
  }

  selectSuggestion(word: Word): void {
    this.addToSentence(word);
    this.cancelInsert();
  }

  cancelInsert(): void {
    this.activeInsertBoxIndex.set(null);
    this.insertQuery.set('');
  }

  suggestionsPosition(): { top: number; left: number } {
    const rect = this.insertInput()?.nativeElement.getBoundingClientRect();
    if (!rect) {
      return { top: 0, left: 0 };
    }
    return { top: rect.bottom + 6, left: rect.left };
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
        updated.push({ words: [], correctionActive: false, saved: false, saving: false });
        afterNextRender(() => this.scrollSentenceBoxesToBottom(), { injector: this.injector });
      }

      return updated;
    });
  }

  private async saveBoxResults(boxIndex: number, box: SentenceBox): Promise<void> {
    const childId = this.childIdObfuscated();
    if (!childId || box.saving) {
      return;
    }

    this.sentenceBoxes.update((boxes) =>
      boxes.map((current, i) => (i === boxIndex ? { ...current, saving: true } : current))
    );

    try {
      const response = await fetch(`${API_BASE_URL}/words/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          child_id_obfuscated: childId,
          answers: this.dedupeWorstVerdict(box.words)
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to store word answers: ${response.status}`);
      }

      await this.fetchWords();
      await this.fetchProgress();
      this.sentenceBoxes.update((boxes) =>
        boxes.map((current, i) => (i === boxIndex ? { ...current, saving: false, saved: true } : current))
      );
    } catch (error) {
      console.error('Failed to store word answers', error);
      this.sentenceBoxes.update((boxes) =>
        boxes.map((current, i) => (i === boxIndex ? { ...current, saving: false } : current))
      );
    }
  }

  private dedupeWorstVerdict(items: SentenceItem[]): { word_id: number; correct: boolean }[] {
    const correctByWordId = new Map<number, boolean>();
    for (const item of items) {
      const isCorrect = item.status === 'correct';
      const existing = correctByWordId.get(item.word.id);
      correctByWordId.set(item.word.id, existing === undefined ? isCorrect : existing && isCorrect);
    }
    return Array.from(correctByWordId.entries()).map(([word_id, correct]) => ({ word_id, correct }));
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
      await this.fetchProgress();
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

  private async fetchProgress(): Promise<void> {
    const childId = this.childIdObfuscated();
    if (!childId) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/words/progress/${childId}`);
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as WordProgressEntry[];
      const next = new Map<number, AnswerResult[]>();
      for (const entry of payload) {
        next.set(entry.word_id, entry.answers);
      }
      this.wordProgress.set(next);
    } catch (error) {
      console.error('Failed to load word progress', error);
    }
  }

  wordColor(wordId: number): string | null {
    return this.classifyWord(wordId).color;
  }

  private classifyWord(wordId: number): { group: number; color: string | null } {
    const answers = this.wordProgress().get(wordId);
    if (!answers || answers.length === 0) {
      return { group: 3, color: null };
    }

    const sorted = [...answers].sort((a, b) => this.toMs(b.answered_at) - this.toMs(a.answered_at));
    const last = sorted[0];

    if (!last.correct) {
      return { group: 1, color: 'hsl(4 55% 55%)' };
    }

    const lastIncorrectIndex = sorted.findIndex((answer) => !answer.correct);

    if (lastIncorrectIndex === -1) {
      // Never wrong: color by how many correct attempts it has taken, not by elapsed time.
      const correctCount = sorted.length;
      const t = this.clamp01((correctCount - 1) / 2);
      return { group: correctCount >= 3 ? 4 : 2, color: this.gradientColor(t) };
    }

    const now = Date.now();
    const streakAnswers = sorted.slice(0, lastIncorrectIndex);
    const streakStartMs = this.toMs(streakAnswers[streakAnswers.length - 1].answered_at);
    const streakDurationDays = (now - streakStartMs) / this.oneDayMs;

    if (streakAnswers.length >= 3 && streakDurationDays >= 7) {
      return { group: 4, color: this.masteredGreen };
    }

    // Not yet mastered: gradient from egg yellow (just answered) to green (streak nearing a week).
    return { group: 2, color: this.gradientColor(this.clamp01(streakDurationDays / 7)) };
  }

  private readonly oneDayMs = 24 * 60 * 60 * 1000;
  private readonly eggYellow = { r: 255, g: 208, b: 90 };
  private readonly masteredGreenRgb = { r: 63, g: 166, b: 101 };
  private readonly masteredGreen = 'rgb(63, 166, 101)';

  private gradientColor(t: number): string {
    const r = Math.round(this.eggYellow.r + (this.masteredGreenRgb.r - this.eggYellow.r) * t);
    const g = Math.round(this.eggYellow.g + (this.masteredGreenRgb.g - this.eggYellow.g) * t);
    const b = Math.round(this.eggYellow.b + (this.masteredGreenRgb.b - this.eggYellow.b) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }

  private clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
  }

  private toMs(value: string): number {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
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
  saving: boolean;
};

type AnswerResult = {
  correct: boolean;
  answered_at: string;
};

type WordProgressEntry = {
  word_id: number;
  answers: AnswerResult[];
};