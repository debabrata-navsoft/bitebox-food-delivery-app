import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../../core/auth/auth.service';
import { errorMessage } from '../../../core/services/api-error';
import { ROLE_META, Role } from '../../../shared/models/user.models';
import { PasswordToggle } from '../../../shared/components/password-toggle/password-toggle';
import { controlError } from '../../../shared/validators/form-validators';

/** Only allow same-app relative return URLs (prevents open redirects). */
export function safeReturnUrl(url: string | undefined): string | null {
  return url && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\') ? url : null;
}

@Component({
  selector: 'bb-login',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    PasswordToggle,
  ],
  templateUrl: './login.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  // Bound from route data / query params via withComponentInputBinding().
  readonly portal = input<Role>('customer');
  readonly heading = input('Sign in');
  readonly returnUrl = input<string>();
  readonly reason = input<string>();

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly meta = computed(() => ROLE_META[this.portal()]);
  protected readonly otherPortals = computed(() =>
    (['customer', 'restaurant', 'delivery'] as const)
      .filter((role) => role !== this.portal())
      .map((role) => ({ label: ROLE_META[role].label, link: ROLE_META[role].login })),
  );
  protected readonly controlError = controlError;

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.error.set(null);

    this.auth.login({ ...this.form.getRawValue(), portal: this.portal() }).subscribe({
      next: (user) => {
        void this.router.navigateByUrl(safeReturnUrl(this.returnUrl()) ?? ROLE_META[user.role].home);
      },
      error: (err: unknown) => {
        this.error.set(errorMessage(err, 'Unable to sign in. Please try again.'));
        this.submitting.set(false);
      },
    });
  }
}
