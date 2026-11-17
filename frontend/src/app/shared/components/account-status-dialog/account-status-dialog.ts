import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormRoot, TreeValidationResult, form, maxLength, minLength, required } from '@angular/forms/signals';
import { ButtonComponent, IconComponent, SelectOption } from 'nexprime';
import { Observable, firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { errorMessage, fieldErrors } from '../../../core/services/api-error';
import { BB_DIALOG_DATA, BbDialog, BbDialogRef, BbDialogTitle } from '../../dialog/bb-dialog';
import { serverErrors } from '../../forms/form-errors';
import { NP_FORM_FIELDS } from '../../forms/np-form-fields';
import { Permission, USER_STATUS_META, User, UserStatus } from '../../models/user.models';

/** Which permission family covers the account (customers:status, riders:status...). */
export type AccountKind = 'customers' | 'restaurants' | 'riders' | 'admins';

export interface AccountStatusData {
  user: User;
  kind: AccountKind;
  /** Sends the change (the dialog shows the API's errors). */
  save: (status: UserStatus, reason: string) => Observable<User>;
}

/** Statuses a person may set: active/inactive with `<kind>:status`, suspended/blocked with accounts:suspend. */
const needs = (kind: AccountKind, status: UserStatus): Permission =>
  status === 'suspended' || status === 'blocked'
    ? 'accounts:suspend'
    : kind === 'admins'
      ? 'admins:manage'
      : (`${kind}:status` as Permission);

/**
 * Change an account's status: Active, Inactive, Suspended or Blocked, with the reason (required
 * for anything but Active). Anything but Active signs the person out at once.
 */
@Component({
  selector: 'bb-account-status-dialog',
  imports: [FormRoot, NP_FORM_FIELDS, BbDialogTitle, ButtonComponent, IconComponent],
  templateUrl: './account-status-dialog.html',
  styleUrl: './account-status-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountStatusDialog {
  protected readonly data = inject<AccountStatusData>(BB_DIALOG_DATA);
  protected readonly ref = inject<BbDialogRef<User>>(BbDialogRef);
  private readonly auth = inject(AuthService);
  protected readonly meta = USER_STATUS_META;
  protected readonly error = signal<string | null>(null);

  protected readonly options: SelectOption[] = (Object.keys(USER_STATUS_META) as UserStatus[])
    .filter((s) => s !== this.data.user.status && this.auth.can(needs(this.data.kind, s)))
    .map((s) => ({ value: s, label: USER_STATUS_META[s].label }));

  private readonly model = signal({
    status: (this.options[0]?.value ?? '') as UserStatus | '',
    reason: '',
  });
  protected readonly form = form(
    this.model,
    (p) => {
      required(p.status, { message: 'Choose a status' });
      required(p.reason, {
        message: 'Say why (the person and other admins will see it)',
        when: ({ valueOf }) => valueOf(p.status) !== 'active',
      });
      minLength(p.reason, 3, { message: 'At least 3 characters' });
      maxLength(p.reason, 500, { message: 'At most 500 characters' });
    },
    { submission: { action: () => this.save() } },
  );
  protected readonly picked = computed(() => this.model().status || null);

  private async save(): Promise<TreeValidationResult> {
    const { status, reason } = this.model();
    this.error.set(null);
    try {
      this.ref.close(await firstValueFrom(this.data.save(status as UserStatus, reason.trim())));
      return undefined;
    } catch (err) {
      const details = fieldErrors(err);
      if (!details.length) this.error.set(errorMessage(err));
      return serverErrors(this.form, details);
    }
  }
}

/** Opens the dialog; emits the updated user once saved. */
export const openAccountStatus = (dialog: BbDialog, data: AccountStatusData) =>
  dialog.result<AccountStatusDialog, AccountStatusData, User>(AccountStatusDialog, {
    data,
    width: '460px',
  });

/** The snackbar text once saved: "Asha Verma is now suspended". */
export const statusChanged = (user: User) => `${user.name} is now ${USER_STATUS_META[user.status].label.toLowerCase()}`;
