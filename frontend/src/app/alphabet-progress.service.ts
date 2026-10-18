import { Injectable, signal } from '@angular/core';

import { API_BASE_URL } from './api.config';
import { AlphabetAnswer } from './alphabet-scoring';

const REFRESH_INTERVAL_MS = 3 * 60 * 1000;
const MAX_AGE_DAYS = 7;
const MAX_ANSWERS_PER_LETTER = 20;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Keeps the alphabet answers the frontend works with. It is fetched once per
// child, extended locally as answers come in, and only re-fetched every few
// minutes, so playing does not read the API on every question.
@Injectable({ providedIn: 'root' })
export class AlphabetProgressService {
  readonly answers = signal<AlphabetAnswer[]>([]);
  readonly loadState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');

  private childId: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  ensureLoaded(childId: string): void {
    if (this.childId === childId && this.loadState() !== 'idle') {
      return;
    }
    this.childId = childId;
    this.answers.set([]);
    this.loadState.set('idle');
    void this.refresh();
    this.startAutoRefresh();
  }

  recordAnswer(answer: AlphabetAnswer): void {
    this.answers.update((answers) => trim(answers, answer, Date.now()));
  }

  private async refresh(): Promise<void> {
    const childId = this.childId;
    if (!childId) {
      return;
    }
    if (this.loadState() !== 'ready') {
      this.loadState.set('loading');
    }

    try {
      const response = await fetch(`${API_BASE_URL}/alphabet/progress/${childId}`);
      if (!response.ok) {
        throw new Error(`Failed to load alphabet progress: ${response.status}`);
      }
      const answers = (await response.json()) as AlphabetAnswer[];
      this.answers.set(answers);
      this.loadState.set('ready');
    } catch (error) {
      console.error('Failed to load alphabet progress', error);
      if (this.loadState() !== 'ready') {
        this.loadState.set('error');
      }
    }
  }

  private startAutoRefresh(): void {
    this.refreshTimer ??= setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
  }
}

// Add one answer and drop what the API would not return either: anything older
// than a week, and all but the 20 most recent answers per letter.
function trim(answers: AlphabetAnswer[], addition: AlphabetAnswer, nowMs: number): AlphabetAnswer[] {
  const cutoff = nowMs - MAX_AGE_DAYS * ONE_DAY_MS;
  const byLetter = new Map<string, AlphabetAnswer[]>();
  for (const answer of [...answers, addition]) {
    if (Date.parse(answer.answered_at) < cutoff) {
      continue;
    }
    const list = byLetter.get(answer.asked_letter) ?? [];
    list.push(answer);
    byLetter.set(answer.asked_letter, list);
  }

  const result: AlphabetAnswer[] = [];
  for (const list of byLetter.values()) {
    list.sort((a, b) => Date.parse(b.answered_at) - Date.parse(a.answered_at));
    result.push(...list.slice(0, MAX_ANSWERS_PER_LETTER));
  }
  return result;
}
