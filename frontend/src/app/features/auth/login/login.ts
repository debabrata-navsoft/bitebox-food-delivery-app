import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormRoot, TreeValidationResult, form, required } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../../core/auth/auth.service';
import { errorMessage, fieldErrors } from '../../../core/services/api-error';
import { serverErrors, shownError } from '../../../shared/forms/form-errors';
import { emailRules } from '../../../shared/forms/form-rules';
import { NP_FORM_FIELDS } from '../../../shared/forms/np-form-fields';
import { ROLE_META, Role } from '../../../shared/models/user.models';

/** Only allow same-app relative return URLs (prevents open redirects). */
export function safeReturnUrl(url: string | undefined): string | null {
  return url && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\') ? url : null;
}

@Component({
  selector: 'bb-login',
  imports: [
    FormRoot,
    NP_FORM_FIELDS,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
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

  /** Form model (Signal Forms): the single source of truth for the inputs. */
  protected readonly model = signal({ email: '', password: '' });
  protected readonly form = form(
    this.model,
    (path) => {
      emailRules(path.email);
      required(path.password, { message: 'Password is required' });
    },
    { submission: { action: () => this.signIn() } },
  );

  protected readonly error = signal<string | null>(null);
  protected readonly meta = computed(() => ROLE_META[this.portal()]);
  protected readonly otherPortals = computed(() =>
    (['customer', 'restaurant', 'delivery'] as const)
      .filter((role) => role !== this.portal())
      .map((role) => ({ label: ROLE_META[role].label, link: ROLE_META[role].login })),
  );
  protected readonly shownError = shownError;

  /** Runs only when the form is valid (FormRoot calls it on submit). */
  private async signIn(): Promise<TreeValidationResult> {
    this.error.set(null);
    try {
      const user = await firstValueFrom(this.auth.login({ ...this.model(), portal: this.portal() }));
      void this.router.navigateByUrl(safeReturnUrl(this.returnUrl()) ?? ROLE_META[user.role].home);
      return undefined;
    } catch (err) {
      this.error.set(errorMessage(err, 'Unable to sign in. Please try again.'));
      return serverErrors(this.form, fieldErrors(err));
    }
  }
}
