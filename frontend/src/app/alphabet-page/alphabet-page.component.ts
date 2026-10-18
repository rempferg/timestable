import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { AlphabetGameComponent } from '../alphabet-game/alphabet-game.component';
import { LearningMenubarComponent } from '../learning-menubar/learning-menubar.component';

@Component({
  selector: 'app-alphabet-page',
  imports: [LearningMenubarComponent, AlphabetGameComponent],
  templateUrl: './alphabet-page.component.html',
  styleUrl: './alphabet-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AlphabetPageComponent implements OnInit {
  readonly childIdObfuscated = signal<string | null>(null);
  readonly loadState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly errorMessage = signal<string | null>(null);

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
