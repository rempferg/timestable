import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { API_BASE_URL } from '../api.config';

@Component({
  selector: 'app-imprint',
  imports: [FormsModule, RouterModule],
  templateUrl: './imprint.component.html',
  styleUrl: './imprint.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ImprintComponent {
  readonly name = signal('');
  readonly email = signal('');
  readonly content = signal('');
  readonly status = signal<string | null>(null);
  readonly sending = signal(false);

  private prev = { name: '', email: '', content: '' };

  async sendMessage(): Promise<void> {
    const name = this.name().trim();
    const email = this.email().trim();
    const content = this.content().trim();

    if (!name || !email || !content) {
      this.status.set('Bitte fülle alle Felder aus.');
      return;
    }

    if (name === this.prev.name && email === this.prev.email && content === this.prev.content) {
      this.status.set('Nachricht bereits gesendet.');
      return;
    }

    this.sending.set(true);
    this.status.set(null);
    try {
      const response = await fetch(`${API_BASE_URL}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender_name: name, sender_email: email, content })
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      this.prev = { name, email, content };
      this.status.set('Nachricht gesendet.');
    } catch (error) {
      console.error('Failed to send message', error);
      this.status.set('Senden fehlgeschlagen. Bitte später erneut versuchen.');
    } finally {
      this.sending.set(false);
    }
  }
}