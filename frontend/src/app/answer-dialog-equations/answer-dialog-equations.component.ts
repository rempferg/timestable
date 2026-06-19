import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  input,
  output,
  signal
} from '@angular/core';

@Component({
  selector: 'app-answer-dialog-equations',
  standalone: true,
  templateUrl: './answer-dialog-equations.component.html',
  styleUrl: './answer-dialog-equations.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AnswerDialogEquationsComponent implements OnInit, OnDestroy {
  readonly questionId = input.required<number>();
  readonly answersVisible = input<boolean>(true);
  readonly close = output<void>();
  readonly answer = output<boolean>();

  readonly elapsedMs = signal(0);

  readonly factorA = computed(() => Math.floor(this.questionId() / 11));
  readonly factorB = computed(() => this.questionId() % 11);
  readonly result = computed(() => this.factorA() * this.factorB());
  readonly missingSide = signal<'left' | 'right'>(
    Math.random() < 0.5 ? 'left' : 'right'
  );
  readonly elapsedLabel = computed(() => {
    const totalMs = this.elapsedMs();
    const seconds = Math.floor(totalMs / 1000);
    const tenth = Math.floor((totalMs % 1000) / 100);
    return `${seconds}.${tenth.toString()}`;
  });
  readonly resultRevealed = signal(false);
  readonly showMissing = computed(() => this.answersVisible() || this.resultRevealed());
  readonly isRunning = signal(false);

  private intervalId: ReturnType<typeof setInterval> | undefined;
  private startTimestamp = 0;
  private readonly keydownHandler = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.close.emit();
    }
  };

  constructor() {
    effect(() => {
      if (this.answersVisible()) {
        this.resultRevealed.set(false);
        this.stopTimer();
        this.resetTimer();
        return;
      }

      if (!this.isRunning() && this.elapsedMs() === 0) {
        this.startTimer();
      }
    });
  }

  ngOnInit(): void {
    document.addEventListener('keydown', this.keydownHandler);
    if (!this.answersVisible()) {
      this.startTimer();
    }
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.keydownHandler);
    this.stopTimer();
  }

  revealResult(): void {
    if (!this.showMissing()) {
      this.elapsedMs.set(Date.now() - this.startTimestamp);
      this.resultRevealed.set(true);
      this.stopTimer();
    }
  }

  handleAnswer(correct: boolean): void {
    if (!this.answersVisible() && !this.resultRevealed()) {
      this.close.emit();
      return;
    }

    this.answer.emit(correct);
  }

  handleDialogClick(event: MouseEvent): void {
    event.stopPropagation();
    if (!this.answersVisible()) {
      return;
    }

    if (this.isRunning()) {
      this.stopTimer();
      return;
    }

    if (this.elapsedMs() > 0) {
      this.resetTimer();
      return;
    }

    this.startTimer();
  }

  private startTimer(): void {
    if (this.intervalId) {
      return;
    }
    this.startTimestamp = Date.now() - this.elapsedMs();
    this.intervalId = setInterval(() => {
      this.elapsedMs.set(Date.now() - this.startTimestamp);
    }, 10);
    this.isRunning.set(true);
  }

  private stopTimer(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.isRunning.set(false);
  }

  private resetTimer(): void {
    this.elapsedMs.set(0);
    this.startTimestamp = Date.now();
  }
}
