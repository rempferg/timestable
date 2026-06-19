import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { DivisionRemainderTableComponent } from '../division-remainder-table/division-remainder-table.component';
import { LearningMenubarComponent } from '../learning-menubar/learning-menubar.component';

@Component({
  selector: 'app-division-remainder-page',
  standalone: true,
  imports: [LearningMenubarComponent, DivisionRemainderTableComponent],
  templateUrl: './division-remainder-page.component.html',
  styleUrl: './division-remainder-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DivisionRemainderPageComponent implements OnInit {
  readonly childIdObfuscated = signal<string | null>(null);
  readonly loadState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly errorMessage = signal<string | null>(null);
  readonly answersVisible = signal(false);

  constructor(private readonly route: ActivatedRoute) {}

  async ngOnInit(): Promise<void> {
    await this.initChildId();
  }

  async initChildId(): Promise<void> {
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

  toggleVisibility(): void {
    this.answersVisible.update((current) => !current);
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
