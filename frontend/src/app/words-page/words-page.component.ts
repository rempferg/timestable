import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterModule } from '@angular/router';

import { WordListComponent } from '../word-list/word-list.component';

@Component({
  selector: 'app-words-page',
  imports: [RouterModule, WordListComponent],
  templateUrl: './words-page.component.html',
  styleUrl: './words-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WordsPageComponent {}