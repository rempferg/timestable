import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-learning-menubar',
  imports: [RouterModule],
  templateUrl: './learning-menubar.component.html',
  styleUrl: './learning-menubar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LearningMenubarComponent {
  @Input() answersVisible = false;
  @Input() showVisibilityToggle = true;
  @Input() showProgressToggle = false;
  @Output() readonly visibilityToggle = new EventEmitter<void>();
  @Output() readonly progressToggle = new EventEmitter<void>();

  get singleButton(): boolean {
    return !this.showVisibilityToggle && !this.showProgressToggle;
  }

  onToggleVisibility(): void {
    this.visibilityToggle.emit();
  }

  onToggleProgress(): void {
    this.progressToggle.emit();
  }
}
