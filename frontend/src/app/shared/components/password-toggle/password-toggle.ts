import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/**
 * Show/hide button for a password input. Place it inside the form field:
 *
 *   <input matInput #pw type="password" formControlName="password" />
 *   <bb-password-toggle matSuffix [input]="pw" />
 */
@Component({
  selector: 'bb-password-toggle',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './password-toggle.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PasswordToggle {
  readonly input = input.required<HTMLInputElement>();
  protected readonly visible = signal(false);

  protected toggle(): void {
    this.visible.update((v) => !v);
    this.input().type = this.visible() ? 'text' : 'password';
  }
}
