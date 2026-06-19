import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-learning-menubar',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './learning-menubar.component.html',
  styleUrl: './learning-menubar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LearningMenubarComponent {
  @Input() answersVisible = false;
  @Output() readonly visibilityToggle = new EventEmitter<void>();

  onToggleVisibility(): void {
    this.visibilityToggle.emit();
  }
}
