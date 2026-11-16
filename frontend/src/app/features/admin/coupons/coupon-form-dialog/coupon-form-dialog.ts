import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormRoot, TreeValidationResult, form } from '@angular/forms/signals';
import { ButtonComponent, IconComponent, SelectComponent, ToggleComponent } from 'nexprime';
import { firstValueFrom, map } from 'rxjs';
import { AdminCatalogService } from '../../../../core/services/admin/admin-catalog.service';
import { errorMessage, fieldErrors } from '../../../../core/services/api-error';
import { AdminCouponService } from '../../../../core/services/checkout-api.service';
import { CouponFields } from '../../../../shared/coupons/coupon-fields/coupon-fields';
import {
  asOptions,
  couponFormModel,
  couponFormSchema,
  couponInput,
  refIds,
  withChosen,
} from '../../../../shared/coupons/coupon-form';
import { loaded } from '../../../../shared/coupons/coupon-list';
import { BB_DIALOG_DATA, BbDialogRef, BbDialogTitle } from '../../../../shared/dialog/bb-dialog';
import { serverErrors } from '../../../../shared/forms/form-errors';
import { NP_FORM_FIELDS } from '../../../../shared/forms/np-form-fields';
import { AdminCoupon } from '../../../../shared/models/checkout.models';

/** Create or edit a coupon: the discount, who and where it applies, limits and dates. */
@Component({
  selector: 'bb-coupon-form-dialog',
  imports: [ToggleComponent, NP_FORM_FIELDS, SelectComponent, FormRoot, BbDialogTitle, ButtonComponent, IconComponent, CouponFields],
  templateUrl: './coupon-form-dialog.html',
  styleUrl: './coupon-form-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CouponFormDialog {
  protected readonly data = inject<AdminCoupon | null>(BB_DIALOG_DATA);
  protected readonly ref = inject<BbDialogRef<AdminCoupon>>(BbDialogRef);
  private readonly service = inject(AdminCouponService);
  private readonly catalog = inject(AdminCatalogService);
  protected readonly error = signal<string | null>(null);
  /** A restaurant's own offer stays tied to that restaurant. */
  protected readonly restaurantOffer = this.data?.source === 'restaurant';
  protected readonly restaurantName =
    this.data?.restaurant && typeof this.data.restaurant === 'object' ? this.data.restaurant.name : null;
  /** Why an admin turned this offer down last time, shown while editing it. */
  protected readonly rejection =
    this.data?.approvalStatus === 'rejected' ? (this.data.rejectionReason ?? null) : null;

  private readonly restaurantList = rxResource({
    stream: () =>
      this.catalog.restaurants({ status: 'approved', limit: 100 }).pipe(map((page) => asOptions(page.items))),
  });
  private readonly categoryList = rxResource({ stream: () => this.catalog.categories().pipe(map(asOptions)) });
  protected readonly restaurantOptions = computed(() =>
    withChosen(loaded(this.restaurantList), this.data?.restaurants),
  );
  protected readonly categoryOptions = computed(() =>
    withChosen(loaded(this.categoryList), this.data?.categories),
  );
  protected readonly restaurantIds = signal(refIds(this.data?.restaurants));
  protected readonly categoryIds = signal(refIds(this.data?.categories));

  protected readonly model = signal(couponFormModel(this.data));
  protected readonly form = form(this.model, (path) => couponFormSchema(path, !!this.data), {
    submission: { action: () => this.save() },
  });

  private async save(): Promise<TreeValidationResult> {
    const input = {
      ...couponInput(this.model()),
      categories: this.categoryIds(),
      ...(this.restaurantOffer ? {} : { restaurants: this.restaurantIds() }),
    };
    this.error.set(null);
    try {
      this.ref.close(
        await firstValueFrom(this.data ? this.service.update(this.data.id, input) : this.service.create(input)),
      );
      return undefined;
    } catch (err) {
      this.error.set(errorMessage(err));
      return serverErrors(this.form, fieldErrors(err));
    }
  }
}
