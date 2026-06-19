import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';

import { API_BASE_URL } from '../api.config';

@Component({
  selector: 'app-division-remainder-overview',
  standalone: true,
  templateUrl: './division-remainder-overview.component.html',
  styleUrl: './division-remainder-overview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DivisionRemainderOverviewComponent {
  private readonly apiBase = API_BASE_URL;
  private readonly minDividend = 0;
  private readonly maxDividend = 100;
  private readonly minDivisor = 1;
  private readonly maxDivisor = 10;

  readonly childIdObfuscated = input.required<string>();
  readonly progressByQuestion = signal<Map<number, AnswerResult[]>>(new Map());

  readonly dividends = Array.from(
    { length: this.maxDividend - this.minDividend + 1 },
    (_, i) => i + this.minDividend
  );

  readonly divisors = Array.from(
    { length: this.maxDivisor - this.minDivisor + 1 },
    (_, i) => i + this.minDivisor
  );

  constructor() {
    effect(() => {
      const childId = this.childIdObfuscated();
      void this.loadProgress(childId);
    });
  }

  isValidCell(dividend: number, divisor: number): boolean {
    return Math.floor(dividend / divisor) <= 10;
  }

  cellColor(dividend: number, divisor: number): string {
    if (!this.isValidCell(dividend, divisor)) {
      return 'rgba(17, 24, 39, 0.18)';
    }

    const questionId = this.questionId(dividend, divisor);
    const answers = this.progressByQuestion().get(questionId);

    if (!answers || answers.length === 0) {
      return 'rgba(255, 255, 255, 0.8)';
    }

    const sortedAnswers = this.sortAnswersByTime(answers);
    const latestAnswer = sortedAnswers[0];

    if (!latestAnswer?.correct) {
      return 'rgba(213, 0, 0, 0.78)';
    }

    const pRecall = this.calculatePRecall(sortedAnswers);

    if (pRecall > 0.9) {
      return 'rgba(0, 200, 83, 0.85)';
    }

    const recallRanks = this.buildRecallRanks();
    const rank = recallRanks.get(questionId) ?? 0;
    const t = this.clamp(rank);
    const orange = { r: 255, g: 165, b: 0 };
    const green = { r: 0, g: 200, b: 83 };

    const r = Math.round(orange.r + (green.r - orange.r) * t);
    const g = Math.round(orange.g + (green.g - orange.g) * t);
    const b = Math.round(orange.b + (green.b - orange.b) * t);

    return `rgba(${r}, ${g}, ${b}, 0.82)`;
  }

  private questionId(dividend: number, divisor: number): number {
    return dividend * this.maxDivisor + (divisor - this.minDivisor);
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
    return [...answers].sort((a, b) => this.toMs(b.answered_at) - this.toMs(a.answered_at));
  }

  private toMs(value: string): number {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private clamp(value: number): number {
    return Math.min(1, Math.max(0, value));
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
      console.error('Failed to load division-remainder progress', error);
    }
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
