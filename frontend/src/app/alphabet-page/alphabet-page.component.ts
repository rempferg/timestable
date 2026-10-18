import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { AlphabetGameComponent } from '../alphabet-game/alphabet-game.component';
import { AlphabetProgressComponent } from '../alphabet-progress/alphabet-progress.component';
import { LearningMenubarComponent } from '../learning-menubar/learning-menubar.component';

@Component({
  selector: 'app-alphabet-page',
  imports: [LearningMenubarComponent, AlphabetGameComponent, AlphabetProgressComponent],
  templateUrl: './alphabet-page.component.html',
  styleUrl: './alphabet-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'closeProgress()'
  }
})
export class AlphabetPageComponent implements OnInit {
  readonly childIdObfuscated = signal<string | null>(null);
  readonly loadState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly errorMessage = signal<string | null>(null);
  readonly progressOpen = signal(false);

  private readonly injector = inject(Injector);
  private readonly progressCloseButton = viewChild<ElementRef<HTMLButtonElement>>('progressCloseButton');

  constructor(private readonly route: ActivatedRoute) {}

  ngOnInit(): void {
    this.initChildId();
  }

  initChildId(): void {
    this.loadState.set('loading');
    this.errorMessage.set(null);

    const existingId = this.getChildIdFromUrl();
    if (existingId) {
      this.childIdObfuscated.set(existingId);
      this.loadState.set('ready');
      return;
    }

    this.loadState.set('error');
    this.errorMessage.set('Missing child id in URL.');
  }

  openProgress(): void {
    this.progressOpen.set(true);
    afterNextRender(() => this.progressCloseButton()?.nativeElement.focus(), {
      injector: this.injector
    });
  }

  closeProgress(): void {
    this.progressOpen.set(false);
  }

  onOverlayClick(event: Event): void {
    event.stopPropagation();
    if (event.target === event.currentTarget) {
      this.closeProgress();
    }
  }

  private getChildIdFromUrl(): string | null {
    const directId = this.route.snapshot.queryParamMap.get('id');
    if (directId) {
      return directId;
    }

    const params = new URLSearchParams(window.location.search);
    const keys = Array.from(params.keys());
    if (keys.length === 1 && params.get(keys[0]) === '') {
      return keys[0];
    }

    return null;
  }
}
