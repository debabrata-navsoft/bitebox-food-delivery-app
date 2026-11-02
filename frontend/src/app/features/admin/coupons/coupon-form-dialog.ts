import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { errorMessage, fieldErrors } from '../../../core/services/api-error';
import { AdminCouponService } from '../../../core/services/checkout-api.service';
import { AdminCoupon, AdminCouponInput } from '../../../shared/models/checkout.models';
import { rupeesToPaise } from '../../../shared/pipes/money.pipes';
import { applyServerErrors, controlError } from '../../../shared/validators/form-validators';

const toDateInput = (iso: string | Date) => new Date(iso).toISOString().slice(0, 10);

/** Create / edit a coupon. Money is typed in rupees and sent as paise. */
@Component({
  selector: 'bb-coupon-form-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSlideToggleModule],
  templateUrl: './coupon-form-dialog.html',
  styleUrl: './coupon-form-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CouponFormDialog {
  protected readonly data = inject<AdminCoupon | null>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<CouponFormDialog, AdminCoupon>);
  private readonly service = inject(AdminCouponService);
  protected readonly controlError = controlError;
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly today = new Date();
  protected readonly form = inject(FormBuilder).nonNullable.group({
    code: [this.data?.code ?? '', [Validators.required, Validators.pattern(/^[A-Za-z0-9_-]{3,30}$/)]],
    description: [this.data?.description ?? ''],
    discountType: [this.data?.discountType ?? ('percent' as 'percent' | 'flat')],
    discount: [
      this.data ? (this.data.discountType === 'percent' ? this.data.discountValue : this.data.discountValue / 100) : (null as number | null),
      [Validators.required, Validators.min(1)],
    ],
    maxDiscount: [this.data?.maxDiscountPaise ? this.data.maxDiscountPaise / 100 : (null as number | null), Validators.min(0)],
    minOrder: [this.data ? this.data.minOrderPaise / 100 : 0, Validators.min(0)],
    perUserLimit: [this.data?.perUserLimit ?? 1, [Validators.required, Validators.min(1), Validators.max(100)]],
    validFrom: [toDateInput(this.data?.validFrom ?? this.today), Validators.required],
    validUntil: [toDateInput(this.data?.validUntil ?? new Date(this.today.getTime() + 30 * 86_400_000)), Validators.required],
    usageLimit: [this.data?.usageLimit ?? (null as number | null), Validators.min(1)],
    isActive: [this.data?.isActive ?? true],
  });

  save(): void {
    const v = this.form.getRawValue();
    if (v.discountType === 'percent' && Number(v.discount) > 100) this.form.controls.discount.setErrors({ max: true });
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const percent = v.discountType === 'percent';
    const input: AdminCouponInput = {
      code: v.code.trim().toUpperCase(),
      description: v.description.trim(),
      discountType: v.discountType,
      discountValue: percent ? Math.round(Number(v.discount)) : rupeesToPaise(Number(v.discount)),
      maxDiscountPaise: percent && v.maxDiscount ? rupeesToPaise(Number(v.maxDiscount)) : null,
      minOrderPaise: rupeesToPaise(Number(v.minOrder ?? 0)),
      perUserLimit: Number(v.perUserLimit),
      validFrom: new Date(`${v.validFrom}T00:00:00`).toISOString(),
      validUntil: new Date(`${v.validUntil}T23:59:59`).toISOString(),
      usageLimit: v.usageLimit ? Number(v.usageLimit) : null,
      isActive: v.isActive,
    };
    this.saving.set(true);
    this.error.set(null);
    (this.data ? this.service.update(this.data.id, input) : this.service.create(input)).subscribe({
      next: (coupon) => this.ref.close(coupon),
      error: (err: unknown) => {
        applyServerErrors(this.form, fieldErrors(err));
        this.error.set(errorMessage(err));
        this.saving.set(false);
      },
    });
  }
}
