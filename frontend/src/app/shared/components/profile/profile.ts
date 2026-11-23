import { IconComponent } from 'nexprime';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormRoot, TreeValidationResult, form, required } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../../core/auth/auth.service';
import { errorMessage, fieldErrors } from '../../utils/api-error';
import { NotificationService } from '../../../core/services/notification.service';
import { PageHeader } from '../page-header/page-header';
import { GENDER_LABEL, Gender, ROLE_META, User } from '../../../core/models/user.models';
import { RewardsService } from '../../../core/services/rewards.service';
import { birthDateRange, fromIsoDay, isoDay } from '../../utils/dates';
import { serverErrors, shownError } from '../../forms/form-errors';
import { NP_FORM_FIELDS } from '../../forms/np-form-fields';
import {
  differsFrom,
  matchesField,
  passwordRules,
  phoneRules,
  requiredText,
} from '../../validators/form-rules';
import { PhoneInput } from '../phone-input/phone-input';
import { ImageUpload } from '../image-upload/image-upload';
import { AccountVerification } from './account-verification/account-verification';

const detailsOf = (u: User | null) => ({
  name: u?.name ?? '',
  phone: u?.phone ?? '',
  gender: (u?.gender ?? '') as Gender | '',
  birthDate: fromIsoDay(u?.birthDate),
});

@Component({
  selector: 'bb-profile',
  imports: [
    PhoneInput,
    ImageUpload,
    AccountVerification,
    NP_FORM_FIELDS,
    DatePipe,
    FormRoot,
    MatButtonModule,
    IconComponent,
    MatProgressSpinnerModule,
    PageHeader,
  ],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Profile {
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);

  protected readonly user = this.auth.user;
  protected readonly roleLabel = computed(() => {
    const role = this.user()?.role;
    return role ? ROLE_META[role].label : '';
  });

  // Personal details. Customers also give their date of birth once (it drives the birthday treat;
  // support can correct it), through the rewards birthday endpoint.
  private readonly rewards = inject(RewardsService);
  protected readonly isCustomer = computed(() => this.user()?.role === 'customer');
  protected readonly savedBirthDate = computed(() => fromIsoDay(this.user()?.birthDate));
  protected readonly born = birthDateRange(110);
  protected readonly genderOptions = [
    { value: '', label: 'Not set' },
    ...(Object.keys(GENDER_LABEL) as Gender[]).map((g) => ({ value: g, label: GENDER_LABEL[g] })),
  ];
  protected readonly profileModel = signal(detailsOf(null));
  protected readonly profileForm = form(
    this.profileModel,
    (path) => {
      requiredText(path.name, 'Name', { min: 2, max: 80 });
      phoneRules(path.phone, { optional: true });
    },
    { submission: { action: () => this.saveProfile() } },
  );

  // Change password
  protected readonly passwordModel = signal({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  protected readonly passwordForm = form(
    this.passwordModel,
    (path) => {
      required(path.currentPassword, { message: 'Current password is required' });
      passwordRules(path.newPassword, 'New password');
      differsFrom(path.newPassword, path.currentPassword);
      matchesField(path.confirmPassword, path.newPassword);
    },
    { submission: { action: () => this.changePassword() } },
  );

  protected readonly profileError = signal<string | null>(null);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly shownError = shownError;

  constructor() {
    effect(() => {
      const user = this.user();
      if (user && !untracked(() => this.profileForm().dirty())) {
        untracked(() => this.profileForm().reset(detailsOf(user)));
      }
    });
  }

  private async saveProfile(): Promise<TreeValidationResult> {
    this.profileError.set(null);
    try {
      const { name, phone, gender, birthDate } = this.profileModel();
      if (birthDate && this.isCustomer() && !this.user()?.birthDate) {
        await firstValueFrom(this.rewards.saveBirthday(isoDay(birthDate)));
      }
      // Saved last, so the user it returns carries the new date of birth too.
      const user = await firstValueFrom(
        this.auth.updateProfile({ name, phone, gender: gender || null }),
      );
      this.profileForm().reset(detailsOf(user));
      this.notify.success('Profile updated');
      return undefined;
    } catch (err) {
      this.profileError.set(errorMessage(err));
      return serverErrors(this.profileForm, fieldErrors(err));
    }
  }

  /** A new photo was uploaded (or removed): save it on the profile. */
  protected saveAvatar(url: string): void {
    this.auth.updateProfile({ avatarUrl: url || null }).subscribe({
      next: () => this.notify.success(url ? 'Photo updated' : 'Photo removed'),
      error: (err: unknown) => this.notify.error(errorMessage(err)),
    });
  }

  private async changePassword(): Promise<TreeValidationResult> {
    this.passwordError.set(null);
    const { currentPassword, newPassword } = this.passwordModel();
    try {
      this.notify.success(
        await firstValueFrom(this.auth.changePassword({ currentPassword, newPassword })),
      );
      return undefined;
    } catch (err) {
      this.passwordError.set(errorMessage(err));
      return serverErrors(this.passwordForm, fieldErrors(err));
    }
  }
}
