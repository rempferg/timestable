import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-data-protection-notice',
  imports: [RouterModule],
  templateUrl: './data-protection-notice.component.html',
  styleUrl: './data-protection-notice.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DataProtectionNoticeComponent {}