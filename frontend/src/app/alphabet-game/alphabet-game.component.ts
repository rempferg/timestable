import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  signal
} from '@angular/core';

import { AlphabetProgressService } from '../alphabet-progress.service';
import { API_BASE_URL } from '../api.config';
import {
  BASE_LETTERS,
  TARGET_LETTERS,
  baseIndex,
  computeBadness
} from '../alphabet-scoring';

// Letter picking: chance is proportional to how wrong the child is, softened so
// it stays varied.
const UNSEEN_BADNESS = 0.6; // letters with no recent data still get explored
const BADNESS_FLOOR = 0.08; // mastered letters keep a small chance to show up
const FOCUS_EXPONENT = 1.5; // >1 leans further towards the weakest letters
const MIN_GAP = 3; // a letter cannot return within this many questions
const RAMP_END = 8; // and is fully eligible again after this many

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
export class AlphabetGameComponent implements OnInit, OnDestroy {
  readonly childIdObfuscated = input<string | null>(null);
  readonly preview = input(false);

  readonly letters = BASE_LETTERS;
  // Six stars share the hit burst; each gets its own outgoing direction in CSS.
  readonly stars = [0, 1, 2, 3, 4, 5];
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

  private readonly progressService = inject(AlphabetProgressService);
  private displayedAtMs = 0;
  private audioContext: AudioContext | null = null;
  private questionIndex = 0;
  private readonly lastAskedAt = new Map<string, number>();

  ngOnInit(): void {
    if (this.preview()) {
      this.target.set('K');
      this.clickedIndex.set(this.correctIndex() + 3);
      this.phase.set('answered');
      return;
    }
    const childId = this.childIdObfuscated();
    if (childId) {
      this.progressService.ensureLoaded(childId);
    }
    this.startRound();
  }

  ngOnDestroy(): void {
    void this.audioContext?.close();
    this.audioContext = null;
  }

  startRound(): void {
    this.questionIndex += 1;
    const letter = this.pickTarget();
    this.lastAskedAt.set(letter, this.questionIndex);
    this.target.set(letter);
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

  isHit(index: number): boolean {
    return this.phase() === 'answered' && index === this.correctIndex() && this.distance() === 0;
  }

  tileClass(index: number): string {
    if (this.phase() !== 'answered') {
      return '';
    }
    if (index === this.correctIndex()) {
      return this.distance() === 0 ? 'is-correct is-hit' : 'is-correct';
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
    this.progressService.recordAnswer({
      asked_letter: this.target(),
      clicked_offset: offset,
      answered_at: new Date().toISOString()
    });
    if (offset === 0) {
      this.playHitSound();
    }
    void this.storeAnswer(this.target(), offset, timeToClickMs);
  }

  // Weighted random over the asked letters: chance grows with how wrong the
  // child is, drops to zero right after a letter is asked, and recovers over the
  // next few questions.
  private pickTarget(): string {
    const badness = computeBadness(this.progressService.answers());
    const weights = TARGET_LETTERS.map((letter) => {
      const letterBadness = Math.max(badness.get(letter) ?? UNSEEN_BADNESS, BADNESS_FLOOR);
      return Math.pow(letterBadness, FOCUS_EXPONENT) * this.cooldown(letter);
    });

    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) {
      return TARGET_LETTERS[Math.floor(Math.random() * TARGET_LETTERS.length)];
    }

    let roll = Math.random() * total;
    for (let i = 0; i < TARGET_LETTERS.length; i++) {
      roll -= weights[i];
      if (roll <= 0) {
        return TARGET_LETTERS[i];
      }
    }
    return TARGET_LETTERS[TARGET_LETTERS.length - 1];
  }

  private cooldown(letter: string): number {
    const lastAsked = this.lastAskedAt.get(letter);
    if (lastAsked === undefined) {
      return 1;
    }
    const gap = this.questionIndex - lastAsked;
    if (gap >= RAMP_END) {
      return 1;
    }
    if (gap < MIN_GAP) {
      return 0;
    }
    return (gap - MIN_GAP + 1) / (RAMP_END - MIN_GAP + 1);
  }

  // A short two-note chime, synthesized so no audio file has to be shipped.
  // Created here because the browser only allows audio after a user gesture.
  private playHitSound(): void {
    try {
      const AudioContextCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        return;
      }
      this.audioContext ??= new AudioContextCtor();
      const context = this.audioContext;
      if (context.state === 'suspended') {
        void context.resume();
      }
      const start = context.currentTime;
      const notes = [880, 1318.51];
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        const noteStart = start + index * 0.09;
        gain.gain.setValueAtTime(0, noteStart);
        gain.gain.linearRampToValueAtTime(0.18, noteStart + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.3);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(noteStart);
        oscillator.stop(noteStart + 0.32);
      });
    } catch (error) {
      console.error('Failed to play hit sound', error);
    }
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
}

function nowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
