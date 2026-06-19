import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, effect, input, signal } from '@angular/core';

import { API_BASE_URL } from '../api.config';
import { AnswerDialogDivisionRemainderComponent } from '../answer-dialog-division-remainder/answer-dialog-division-remainder.component';

@Component({
  selector: 'app-division-remainder-table',
  standalone: true,
  templateUrl: './division-remainder-table.component.html',
  styleUrl: './division-remainder-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AnswerDialogDivisionRemainderComponent]
})
export class DivisionRemainderTableComponent implements OnInit, OnDestroy {
  private readonly apiBase = API_BASE_URL;
  private readonly pageSize = 10;
  private readonly firstPageSize = 11;
  private readonly rowHeightPx = 44;
  private readonly minDividend = 0;
  private readonly maxDividend = 100;
  private readonly minDivisor = 1;
  private readonly maxDivisor = 10;
  private readonly swipeThresholdPx = 48;

  readonly childIdObfuscated = input.required<string>();
  readonly answersVisible = input<boolean>(true);
  readonly progressByQuestion = signal<Map<number, AnswerResult[]>>(new Map());
  readonly flashQuestionId = signal<number | null>(null);
  readonly currentRangeStart = signal(0);
  readonly isCompactLayout = signal(false);

  readonly divisors = Array.from(
    { length: this.maxDivisor - this.minDivisor + 1 },
    (_, i) => i + this.minDivisor
  );
  readonly rangeStarts = this.buildRangeStarts();

  hoverRow: number | null = null;
  hoverCol: number | null = null;
  selectedQuestionId: number | null = null;

  private refreshIntervalId: number | null = null;
  private flashTimeoutId: number | null = null;
  private touchStartX: number | null = null;

  private readonly visibilityHandler = (): void => {
    if (document.visibilityState === 'visible') {
      void this.loadProgress(this.childIdObfuscated());
    }
  };

  private readonly resizeHandler = (): void => {
    this.isCompactLayout.set(window.innerWidth <= 640);
  };

  constructor() {
    effect(() => {
      const childId = this.childIdObfuscated();
      this.restoreRangeStart(childId);
      void this.loadProgress(childId);
    });
  }

  ngOnInit(): void {
    document.addEventListener('visibilitychange', this.visibilityHandler);
    window.addEventListener('resize', this.resizeHandler);
    this.resizeHandler();
    this.refreshIntervalId = window.setInterval(() => {
      this.progressByQuestion.update((current) => new Map(current));
    }, 5000);
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    window.removeEventListener('resize', this.resizeHandler);
    if (this.refreshIntervalId !== null) {
      window.clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
  }

  get cellCount(): number {
    return this.divisors.length + 1;
  }

  get gridTemplate(): string {
    return `repeat(${this.cellCount}, minmax(0, 1fr))`;
  }

  get rowTemplate(): string {
    const rowCount = this.visibleDividends().length + 1;
    return this.isCompactLayout()
      ? `repeat(${rowCount}, ${this.rowHeightPx}px)`
      : `repeat(${rowCount}, minmax(0, 1fr))`;
  }

  get rangeLabel(): string {
    return this.formatRange(this.currentRangeStart());
  }

  get seenCountInRange(): number {
    let seen = 0;
    for (const dividend of this.visibleDividends()) {
      for (const divisor of this.divisors) {
        if (!this.isValidQuestion(dividend, divisor)) {
          continue;
        }
        if ((this.progressByQuestion().get(this.questionId(dividend, divisor))?.length ?? 0) > 0) {
          seen += 1;
        }
      }
    }
    return seen;
  }

  get weakCountInRange(): number {
    let weak = 0;
    for (const dividend of this.visibleDividends()) {
      for (const divisor of this.divisors) {
        if (!this.isValidQuestion(dividend, divisor)) {
          continue;
        }
        if (this.isWeak(this.questionId(dividend, divisor))) {
          weak += 1;
        }
      }
    }
    return weak;
  }

  get questionCountInRange(): number {
    let count = 0;
    for (const dividend of this.visibleDividends()) {
      for (const divisor of this.divisors) {
        if (this.isValidQuestion(dividend, divisor)) {
          count += 1;
        }
      }
    }
    return count;
  }

  visibleDividends(): number[] {
    const start = this.currentRangeStart();
    const end = Math.min(this.maxDividend, start + this.rangeSizeForStart(start) - 1);
    const length = end - start + 1;
    return Array.from({ length }, (_, i) => start + i);
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

  questionId(dividend: number, divisor: number): number {
    return dividend * this.maxDivisor + (divisor - this.minDivisor);
  }

  quotient(dividend: number, divisor: number): number {
    return Math.floor(dividend / divisor);
  }

  isValidQuestion(dividend: number, divisor: number): boolean {
    return this.quotient(dividend, divisor) <= 10;
  }

  remainder(dividend: number, divisor: number): number {
    return dividend % divisor;
  }

  isFlashCell(dividend: number, divisor: number): boolean {
    return this.isValidQuestion(dividend, divisor) && this.flashQuestionId() === this.questionId(dividend, divisor);
  }

  cellColor(dividend: number, divisor: number): string {
    if (!this.isValidQuestion(dividend, divisor)) {
      return 'rgba(0, 0, 0, 0.04)';
    }

    const questionId = this.questionId(dividend, divisor);
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

  openQuestion(dividend: number, divisor: number): void {
    if (!this.isValidQuestion(dividend, divisor)) {
      return;
    }

    this.selectedQuestionId = this.questionId(dividend, divisor);
  }

  closeQuestion(): void {
    this.selectedQuestionId = null;
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

  canGoPrev(): boolean {
    return this.currentRangeIndex() > 0;
  }

  canGoNext(): boolean {
    return this.currentRangeIndex() < this.rangeStarts.length - 1;
  }

  goPrev(): void {
    if (!this.canGoPrev()) {
      return;
    }
    this.setRangeStart(this.rangeStarts[this.currentRangeIndex() - 1]);
  }

  goNext(): void {
    if (!this.canGoNext()) {
      return;
    }
    this.setRangeStart(this.rangeStarts[this.currentRangeIndex() + 1]);
  }

  onRangeSelected(startValue: string): void {
    const parsed = Number(startValue);
    if (Number.isNaN(parsed)) {
      return;
    }
    this.setRangeStart(parsed);
  }

  handleTouchStart(event: TouchEvent): void {
    if (event.touches.length === 0) {
      return;
    }
    this.touchStartX = event.touches[0].clientX;
  }

  handleTouchEnd(event: TouchEvent): void {
    if (this.touchStartX === null || event.changedTouches.length === 0) {
      this.touchStartX = null;
      return;
    }

    const deltaX = event.changedTouches[0].clientX - this.touchStartX;
    this.touchStartX = null;

    if (Math.abs(deltaX) < this.swipeThresholdPx) {
      return;
    }

    if (deltaX < 0) {
      this.goNext();
      return;
    }

    this.goPrev();
  }

  private setRangeStart(start: number): void {
    const allowed = this.rangeStarts.includes(start) ? start : this.rangeStarts[0];
    this.currentRangeStart.set(allowed);
    this.persistRangeStart(this.childIdObfuscated(), allowed);
  }

  formatRange(start: number): string {
    const end = Math.min(this.maxDividend, start + this.rangeSizeForStart(start) - 1);
    return `${start}-${end}`;
  }

  private currentRangeIndex(): number {
    const index = this.rangeStarts.indexOf(this.currentRangeStart());
    return index >= 0 ? index : 0;
  }

  private buildRangeStarts(): number[] {
    const starts: number[] = [this.minDividend];
    let nextStart = this.minDividend + this.firstPageSize;

    while (nextStart <= this.maxDividend) {
      starts.push(nextStart);
      nextStart += this.pageSize;
    }

    return starts;
  }

  private rangeSizeForStart(start: number): number {
    return start === this.minDividend ? this.firstPageSize : this.pageSize;
  }

  private isWeak(questionId: number): boolean {
    const answers = this.progressByQuestion().get(questionId);

    if (!answers || answers.length === 0) {
      return false;
    }

    const sortedAnswers = this.sortAnswersByTime(answers);
    const latest = sortedAnswers[0];

    if (!latest?.correct) {
      return true;
    }

    return this.calculatePRecall(sortedAnswers) <= 0.5;
  }

  private buildRecallRanks(): Map<number, number> {
    const scores = new Map<number, number>();

    for (const [questionId, answers] of this.progressByQuestion().entries()) {
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
    return [...answers].sort((a, b) => this.toMs(b.answered_at) - this.toMs(a.answered_at));
  }

  private toMs(value: string): number {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private clamp(value: number): number {
    return Math.min(1, Math.max(0, value));
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

  private async sendAnswer(questionId: number, correct: boolean): Promise<void> {
    const params = new URLSearchParams({
      child_id_obfuscated: this.childIdObfuscated(),
      question_id: String(questionId),
      correct: String(correct)
    });

    try {
      await fetch(`${this.apiBase}/division-remainder/answer?${params.toString()}`, {
        method: 'POST'
      });
    } catch (error) {
      console.error('Failed to send answer', error);
    }
  }

  private async loadProgress(childId: string): Promise<void> {
    try {
      const response = await fetch(`${this.apiBase}/division-remainder/progress/${childId}`);
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

  private rangeStorageKey(childId: string): string {
    return `division-range-start:${childId}`;
  }

  private persistRangeStart(childId: string, start: number): void {
    try {
      localStorage.setItem(this.rangeStorageKey(childId), String(start));
    } catch {
      // Ignore storage failures and keep in-memory state.
    }
  }

  private restoreRangeStart(childId: string): void {
    try {
      const raw = localStorage.getItem(this.rangeStorageKey(childId));
      if (!raw) {
        this.currentRangeStart.set(this.rangeStarts[0]);
        return;
      }

      const parsed = Number(raw);
      if (!Number.isNaN(parsed) && this.rangeStarts.includes(parsed)) {
        this.currentRangeStart.set(parsed);
        return;
      }
    } catch {
      // Ignore storage failures.
    }

    this.currentRangeStart.set(this.rangeStarts[0]);
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
