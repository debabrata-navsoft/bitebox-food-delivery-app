import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent, IconComponent } from 'nexprime';
import {
  BB_DIALOG_DATA,
  BbDialog,
  BbDialogRef,
  BbDialogTitle,
} from '../../../../shared/dialog/bb-dialog';
import { errorCode, errorDetails } from '../../../../shared/utils/api-error';

/** Why an inactive, suspended or blocked account can't sign in. Closes only by its buttons. */
@Component({
  selector: 'bb-account-blocked-dialog',
  imports: [RouterLink, ButtonComponent, IconComponent, BbDialogTitle],
  templateUrl: './account-blocked-dialog.html',
  styleUrl: './account-blocked-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountBlockedDialog {
  /** The API's details: `status` and `reason`. */
  protected readonly data = inject<Record<string, string>>(BB_DIALOG_DATA);
  protected readonly ref = inject(BbDialogRef);
}

/** Opens the dialog if `err` is the API's ACCOUNT_BLOCKED sign-in refusal; true if it did. */
export function showAccountBlocked(dialog: BbDialog, err: unknown): boolean {
  if (errorCode(err) !== 'ACCOUNT_BLOCKED') return false;
  dialog.open(AccountBlockedDialog, { data: errorDetails(err), disableClose: true });
  return true;
}
