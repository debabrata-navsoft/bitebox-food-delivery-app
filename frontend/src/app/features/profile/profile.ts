import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/auth/auth.service';
import { errorMessage, fieldErrors } from '../../core/services/api-error';
import { NotificationService } from '../../core/services/notification.service';
import { PageHeader } from '../../shared/components/page-header/page-header';
import { PasswordToggle } from '../../shared/components/password-toggle/password-toggle';
import { ROLE_META } from '../../shared/models/user.models';
import {
  PHONE_PATTERN,
  applyServerErrors,
  controlError,
  matchFields,
  passwordPolicy,
} from '../../shared/validators/form-validators';

/** Profile details + change password. Shared by every panel. */
@Component({
  selector: 'bb-profile',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    PageHeader,
    PasswordToggle,
  ],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Profile {
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly user = this.auth.user;
  protected readonly roleLabel = computed(() => {
    const role = this.user()?.role;
    return role ? ROLE_META[role].label : '';
  });

  protected readonly profileForm = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    phone: ['', Validators.pattern(PHONE_PATTERN)],
  });

  protected readonly passwordForm = this.fb.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, passwordPolicy]],
      confirmPassword: ['', Validators.required],
    },
    { validators: matchFields('newPassword', 'confirmPassword') },
  );

  protected readonly savingProfile = signal(false);
  protected readonly savingPassword = signal(false);
  protected readonly profileError = signal<string | null>(null);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly controlError = controlError;

  constructor() {
    // Keep the form in sync with the signed-in user (e.g. after session restore).
    effect(() => {
      const user = this.user();
      if (user && this.profileForm.pristine) {
        this.profileForm.reset({ name: user.name, phone: user.phone ?? '' });
      }
    });
  }

  saveProfile(): void {
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }
    this.savingProfile.set(true);
    this.profileError.set(null);
    this.auth.updateProfile(this.profileForm.getRawValue()).subscribe({
      next: (user) => {
        this.profileForm.reset({ name: user.name, phone: user.phone ?? '' });
        this.notify.success('Profile updated');
        this.savingProfile.set(false);
      },
      error: (err: unknown) => {
        applyServerErrors(this.profileForm, fieldErrors(err));
        this.profileError.set(errorMessage(err));
        this.savingProfile.set(false);
      },
    });
  }

  changePassword(): void {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    this.savingPassword.set(true);
    this.passwordError.set(null);
    const { currentPassword, newPassword } = this.passwordForm.getRawValue();
    this.auth.changePassword({ currentPassword, newPassword }).subscribe({
      next: (message) => this.notify.success(message),
      error: (err: unknown) => {
        applyServerErrors(this.passwordForm, fieldErrors(err));
        this.passwordError.set(errorMessage(err));
        this.savingPassword.set(false);
      },
    });
  }
}
