import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../../core/auth/auth.service';
import { errorMessage, fieldErrors } from '../../../core/services/api-error';
import { NotificationService } from '../../../core/services/notification.service';
import { PasswordToggle } from '../../../shared/components/password-toggle/password-toggle';
import { ROLE_META, SelfRegisterRole } from '../../../shared/models/user.models';
import {
  PHONE_PATTERN,
  applyServerErrors,
  controlError,
  matchFields,
  passwordPolicy,
} from '../../../shared/validators/form-validators';

const INTRO: Record<SelfRegisterRole, string> = {
  customer: 'Join BiteBox to order from great local restaurants.',
  restaurant: 'Create your partner account. You will add restaurant details and get approved next.',
  delivery: 'Create your rider account to start accepting deliveries near you.',
};

@Component({
  selector: 'bb-register',
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
  templateUrl: './register.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Register {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);

  readonly role = input<SelfRegisterRole>('customer');
  readonly heading = input('Create your account');

  protected readonly form = inject(FormBuilder).nonNullable.group(
    {
      name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', Validators.pattern(PHONE_PATTERN)],
      password: ['', [Validators.required, passwordPolicy]],
      confirmPassword: ['', Validators.required],
    },
    { validators: matchFields('password', 'confirmPassword') },
  );

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly meta = computed(() => ROLE_META[this.role()]);
  protected readonly intro = computed(() => INTRO[this.role()]);
  protected readonly controlError = controlError;

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.error.set(null);

    const { confirmPassword: _confirm, phone, ...rest } = this.form.getRawValue();
    this.auth.register({ ...rest, ...(phone ? { phone } : {}), role: this.role() }).subscribe({
      next: (user) => {
        this.notify.success(`Welcome to BiteBox, ${user.name.split(' ')[0]}!`);
        void this.router.navigateByUrl(ROLE_META[user.role].home);
      },
      error: (err: unknown) => {
        applyServerErrors(this.form, fieldErrors(err));
        this.error.set(errorMessage(err, 'Unable to create your account. Please try again.'));
        this.submitting.set(false);
      },
    });
  }
}
