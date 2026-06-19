import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, effect, input, signal } from '@angular/core';
import { AnswerDialogEquationsComponent } from '../answer-dialog-equations/answer-dialog-equations.component';
import { API_BASE_URL } from '../api.config';

@Component({
  selector: 'app-times-table-equations',
  standalone: true,
  templateUrl: './times-table-equations.component.html',
  styleUrl: './times-table-equations.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AnswerDialogEquationsComponent]
})
export class TimesTableEquationsComponent implements OnInit, OnDestroy {
  private readonly apiBase = API_BASE_URL;
  readonly childIdObfuscated = input.required<string>();
  readonly answersVisible = input<boolean>(true);
  readonly progressByQuestion = signal<Map<number, AnswerResult[]>>(new Map());
  readonly flashQuestionId = signal<number | null>(null);
  private refreshIntervalId: number | null = null;
  private flashTimeoutId: number | null = null;

  readonly factors = Array.from({ length: 10 }, (_, i) => i + 1);
  readonly cellCount = this.factors.length + 1;

  hoverRow: number | null = null;
  hoverCol: number | null = null;

  selectedQuestionId: number | null = null;

  private selectedFactors = new Set<number>();

  private readonly visibilityHandler = (): void => {
    if (document.visibilityState === 'visible') {
      void this.loadProgress(this.childIdObfuscated());
    }
  };

  constructor() {
    effect(() => {
      const childId = this.childIdObfuscated();
      void this.loadProgress(childId);
    });
  }

  ngOnInit(): void {
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.refreshIntervalId = window.setInterval(() => {
      this.progressByQuestion.update((current) => new Map(current));
    }, 5000);
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    if (this.refreshIntervalId !== null) {
      window.clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
  }

  get gridTemplate(): string {
    return `repeat(${this.cellCount}, minmax(0, 1fr))`;
  }

  setHover(row: number, col: number): void {
    this.hoverRow = row;
    this.hoverCol = col;
  }

  clearHover(): void {
    this.hoverRow = null;
    this.hoverCol = null;
  }

  isHoveredCell(row: number, col: number): boolean {
    return this.hoverRow === row && this.hoverCol === col;
  }

  toggleFactor(factor: number): void {
    const next = new Set(this.selectedFactors);

    if (next.has(factor)) {
      next.delete(factor);
    } else {
      next.add(factor);
    }

    this.selectedFactors = next;
  }

  isSelectedFactor(factor: number): boolean {
    return this.selectedFactors.has(factor);
  }

  hasSelection(): boolean {
    return this.selectedFactors.size > 0;
  }

  isCellSelected(row: number, col: number): boolean {
    return this.selectedFactors.has(row) || this.selectedFactors.has(col);
  }

  isCellDimmed(row: number, col: number): boolean {
    return this.hasSelection() && !this.isCellSelected(row, col);
  }

  cellColor(row: number, col: number): string {
    const questionId = row * 11 + col;
    const answers = this.progressByQuestion().get(questionId);

    if (!answers || answers.length === 0) {
      return '#ffffff';
    }

    const sortedAnswers = this.sortAnswersByTime(answers);
    const latestAnswer = sortedAnswers[0];

    const opacity = 0.5;

    if (!latestAnswer?.correct) {
      return `rgba(213, 0, 0, ${opacity})`;
    }

    const pRecall = this.calculatePRecall(sortedAnswers);

    if (pRecall > 0.9) {
      return `rgba(0, 200, 83, ${opacity})`;
    }

    const recallRanks = this.buildRecallRanks();
    const rank = recallRanks.get(questionId) ?? 0;
    const t = this.clamp(rank);

    const orange = { r: 255, g: 165, b: 0 };
    const green = { r: 0, g: 200, b: 83 };

    const r = Math.round(orange.r + (green.r - orange.r) * t);
    const g = Math.round(orange.g + (green.g - orange.g) * t);
    const b = Math.round(orange.b + (green.b - orange.b) * t);

    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  private buildRecallRanks(): Map<number, number> {
    const scores = new Map<number, number>();
    const entries = Array.from(this.progressByQuestion().entries());

    for (const [questionId, answers] of entries) {
      if (!answers || answers.length === 0) {
        continue;
      }

      const sortedAnswers = this.sortAnswersByTime(answers);
      if (!sortedAnswers[0]?.correct) {
        continue;
      }

      const pRecall = this.calculatePRecall(sortedAnswers);
      if (pRecall > 0.9) {
        continue;
      }
      scores.set(questionId, pRecall);
    }

    const sortedScores = Array.from(scores.entries()).sort((a, b) => a[1] - b[1]);
    const count = sortedScores.length;
    const ranks = new Map<number, number>();

    if (count === 0) {
      return ranks;
    }

    if (count === 1) {
      ranks.set(sortedScores[0][0], 1);
      return ranks;
    }

    sortedScores.forEach(([questionId], index) => {
      ranks.set(questionId, index / (count - 1));
    });

    return ranks;
  }

  private calculatePRecall(sortedAnswers: AnswerResult[]): number {
    const correctStreak: AnswerResult[] = [];
    for (const answer of sortedAnswers) {
      if (!answer.correct) {
        break;
      }
      correctStreak.push(answer);
    }

    const nowMs = Date.now();
    const lastCorrectMs = this.toMs(correctStreak[0]?.answered_at ?? sortedAnswers[0]?.answered_at ?? '');
    const timeSinceLastCorrect = Math.max(0, nowMs - lastCorrectMs);

    let longestDiffMs = 0;
    for (let i = 0; i < correctStreak.length - 1; i += 1) {
      const currentMs = this.toMs(correctStreak[i].answered_at);
      const nextMs = this.toMs(correctStreak[i + 1].answered_at);
      const diff = Math.max(0, currentMs - nextMs);
      if (diff > longestDiffMs) {
        longestDiffMs = diff;
      }
    }

    const initialHalfLifeMs = 60 * 1000;
    const halfLifeMs = Math.max(longestDiffMs * 2.0, initialHalfLifeMs);
    return Math.pow(0.5, timeSinceLastCorrect / halfLifeMs);
  }

  private sortAnswersByTime(answers: AnswerResult[]): AnswerResult[] {
    return [...answers].sort(
      (a, b) => this.toMs(b.answered_at) - this.toMs(a.answered_at)
    );
  }

  private toMs(value: string): number {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private clamp(value: number): number {
    return Math.min(1, Math.max(0, value));
  }

  openQuestion(row: number, col: number): void {
    this.selectedQuestionId = row * 11 + col;
  }

  closeQuestion(): void {
    this.selectedQuestionId = null;
  }

  isFlashCell(row: number, col: number): boolean {
    return this.flashQuestionId() === row * 11 + col;
  }

  private triggerFlash(questionId: number): void {
    if (this.flashTimeoutId !== null) {
      window.clearTimeout(this.flashTimeoutId);
      this.flashTimeoutId = null;
    }

    if (this.flashQuestionId() === questionId) {
      this.flashQuestionId.set(null);
      window.setTimeout(() => this.flashQuestionId.set(questionId), 0);
    } else {
      this.flashQuestionId.set(questionId);
    }

    this.flashTimeoutId = window.setTimeout(() => {
      this.flashQuestionId.set(null);
      this.flashTimeoutId = null;
    }, 3000);
  }

  submitAnswer(correct: boolean): void {
    const questionId = this.selectedQuestionId;

    if (questionId === null) {
      return;
    }

    const answeredAt = this.nowUtcIso();
    this.updateProgress(questionId, { correct, answered_at: answeredAt });
    if (!this.answersVisible()) {
      this.triggerFlash(questionId);
    }
    this.closeQuestion();
    void this.sendAnswer(questionId, correct);
  }

  private async sendAnswer(questionId: number, correct: boolean): Promise<void> {
    const params = new URLSearchParams({
      child_id_obfuscated: this.childIdObfuscated(),
      question_id: String(questionId),
      correct: String(correct)
    });

    try {
      await fetch(`${this.apiBase}/timestable-equations/answer?${params.toString()}`, {
        method: 'POST'
      });
    } catch (error) {
      console.error('Failed to send answer', error);
    }
  }

  private async loadProgress(childId: string): Promise<void> {
    console.log('loadProgress called with childId:', childId);
    try {
      const response = await fetch(`${this.apiBase}/timestable-equations/progress/${childId}`);
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as ProgressEntry[];
      const next = new Map<number, AnswerResult[]>();

      for (const entry of payload) {
        next.set(entry.question_id, entry.answers);
      }

      this.progressByQuestion.set(next);
    } catch (error) {
      console.error('Failed to load progress', error);
    }
  }

  private updateProgress(questionId: number, answer: AnswerResult): void {
    this.progressByQuestion.update((current) => {
      const next = new Map(current);
      const existing = next.get(questionId) ?? [];
      next.set(questionId, [answer, ...existing]);
      return next;
    });
  }

  private nowUtcIso(): string {
    return new Date().toISOString();
  }
}

type AnswerResult = {
  correct: boolean;
  answered_at: string;
};

type ProgressEntry = {
  question_id: number;
  answers: AnswerResult[];
};
