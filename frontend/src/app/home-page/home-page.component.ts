import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';

import { API_BASE_URL } from '../api.config';
import { DivisionRemainderOverviewComponent } from '../division-remainder-overview/division-remainder-overview.component';
import { PlusTableEquationsComponent } from '../plus-table-equations/plus-table-equations.component';
import { PlusTableComponent } from '../plus-table/plus-table.component';
import { TimesTableEquationsComponent } from '../times-table-equations/times-table-equations.component';
import { TimesTableComponent } from '../times-table/times-table.component';

@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [
    RouterModule,
    TimesTableComponent,
    TimesTableEquationsComponent,
    PlusTableComponent,
    PlusTableEquationsComponent,
    DivisionRemainderOverviewComponent
  ],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomePageComponent implements OnInit {
  readonly childIdObfuscated = signal<string | null>(null);
  readonly loadState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly errorMessage = signal<string | null>(null);

  constructor(
    private readonly route: ActivatedRoute
  ) {}

  async ngOnInit(): Promise<void> {
    await this.ensureChildId();
  }

  async ensureChildId(): Promise<void> {
    this.loadState.set('loading');
    this.errorMessage.set(null);

    const directId = this.getChildIdFromUrl();
    if (directId) {
      this.childIdObfuscated.set(directId);
      this.loadState.set('ready');
      return;
    }

    const legacyId = this.getLegacyChildIdFromUrl();
    if (legacyId) {
      this.childIdObfuscated.set(legacyId);
      this.updateUrlWithChildId(legacyId);
      this.loadState.set('ready');
      return;
    }

    const newId = await this.requestNewChildId();
    if (!newId) {
      this.loadState.set('error');
      this.errorMessage.set('Konnte keine ID abrufen.');
      return;
    }

    this.childIdObfuscated.set(newId);
    this.updateUrlWithChildId(newId);
    this.loadState.set('ready');
  }

  private getChildIdFromUrl(): string | null {
    const directId = this.route.snapshot.queryParamMap.get('id');
    if (directId) {
      return directId;
    }
    return null;
  }

  private getLegacyChildIdFromUrl(): string | null {
    const params = new URLSearchParams(window.location.search);
    const keys = Array.from(params.keys());
    if (keys.length === 1 && params.get(keys[0]) === '') {
      return keys[0];
    }
    return null;
  }

  private async requestNewChildId(): Promise<string | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/id`);
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as { child_id?: string };
      return payload.child_id ?? null;
    } catch (error) {
      console.error('Failed to fetch child id', error);
      return null;
    }
  }

  private updateUrlWithChildId(childId: string): void {
    const url = `${window.location.origin}${window.location.pathname}?id=${childId}`;
    window.history.replaceState(null, '', url);
  }
}
