import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  /** When set, the user must type a reason (returned as the dialog result). */
  reasonLabel?: string;
}

/**
 * Generic confirmation. Closes with `true`, the typed reason (if
 * `reasonLabel` is set), or `undefined` when cancelled.
 */
@Component({
  selector: 'bb-confirm-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<ConfirmDialog, true | string>);
  protected readonly reason = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(500)] });

  confirm(): void {
    if (!this.data.reasonLabel) {
      this.ref.close(true);
      return;
    }
    if (this.reason.invalid || !this.reason.value.trim()) {
      this.reason.markAsTouched();
      this.reason.setErrors({ required: true });
      return;
    }
    this.ref.close(this.reason.value.trim());
  }
}
