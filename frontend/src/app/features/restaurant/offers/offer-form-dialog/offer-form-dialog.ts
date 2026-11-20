import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormRoot, TreeValidationResult, form } from '@angular/forms/signals';
import { ButtonComponent, IconComponent, SelectComponent } from 'nexprime';
import { firstValueFrom, map } from 'rxjs';
import { errorMessage, fieldErrors } from '../../../../core/services/api-error';
import { CatalogService } from '../../../../core/services/catalog.service';
import { MyOffersService } from '../../../../core/services/my-offers.service';
import { MyRestaurantService } from '../../../../core/services/my-restaurant.service';
import { OfferCard } from '../../../../shared/components/offer-card/offer-card';
import { CouponFields } from '../../../../shared/coupons/coupon-fields/coupon-fields';
import {
  asOptions,
  couponFormModel,
  couponFormSchema,
  couponInput,
  previewOffer,
  refIds,
  withChosen,
} from '../../../../shared/coupons/coupon-form';
import { loaded } from '../../../../shared/coupons/coupon-list';
import { BB_DIALOG_DATA, BbDialogRef, BbDialogTitle } from '../../../../shared/dialog/bb-dialog';
import { serverErrors } from '../../../../shared/forms/form-errors';
import { AdminCoupon, NamedRef } from '../../../../shared/models/checkout.models';

/** Create or edit one of the restaurant's offers, with a preview of how customers see it. */
@Component({
  selector: 'bb-offer-form-dialog',
  imports: [FormRoot, SelectComponent, BbDialogTitle, ButtonComponent, IconComponent, OfferCard, CouponFields],
  templateUrl: './offer-form-dialog.html',
  styleUrl: './offer-form-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfferFormDialog {
  protected readonly data = inject<AdminCoupon | null>(BB_DIALOG_DATA);
  protected readonly ref = inject<BbDialogRef<AdminCoupon>>(BbDialogRef);
  private readonly offers = inject(MyOffersService);
  private readonly mine = inject(MyRestaurantService);
  private readonly catalog = inject(CatalogService);
  protected readonly error = signal<string | null>(null);
  /** An approved offer goes back for review when it is edited. */
  protected readonly wasApproved = this.data?.approvalStatus === 'approved';
  protected readonly rejection =
    this.data?.approvalStatus === 'rejected' ? (this.data.rejectionReason ?? null) : null;
  /** Set by the button that submits: keep it as a draft, or send it. */
  protected readonly asDraft = signal(false);

  private readonly categoryList = rxResource({ stream: () => this.catalog.categories().pipe(map(asOptions)) });
  private readonly dishList = rxResource({
    stream: () => this.mine.foods({ limit: 100 }).pipe(map((page) => asOptions(page.items))),
  });
  protected readonly categoryOptions = computed(() =>
    withChosen(loaded(this.categoryList), this.data?.categories),
  );
  protected readonly dishOptions = computed(() => withChosen(loaded(this.dishList), this.data?.foodItems));
  protected readonly categoryIds = signal(refIds(this.data?.categories));
  protected readonly dishIds = signal(refIds(this.data?.foodItems));

  protected readonly model = signal(couponFormModel(this.data));
  protected readonly form = form(this.model, (path) => couponFormSchema(path, !!this.data), {
    submission: { action: () => this.save() },
  });

  /** The chosen ids as names, for the preview. */
  private picked(ids: string[], options: { value: string; label: string }[]): NamedRef[] {
    return ids.map((id) => ({ id, name: options.find((o) => o.value === id)?.label ?? '' }));
  }
  protected readonly preview = computed(() =>
    previewOffer(this.model(), {
      kind: 'restaurant_offer',
      categories: this.picked(this.categoryIds(), this.categoryOptions()),
      foodItems: this.picked(this.dishIds(), this.dishOptions()),
    }),
  );

  private async save(): Promise<TreeValidationResult> {
    const input = {
      ...couponInput(this.model()),
      categories: this.categoryIds(),
      foodItems: this.dishIds(),
      draft: this.asDraft(),
    };
    this.error.set(null);
    try {
      this.ref.close(
        await firstValueFrom(this.data ? this.offers.update(this.data.id, input) : this.offers.create(input)),
      );
      return undefined;
    } catch (err) {
      this.error.set(errorMessage(err));
      return serverErrors(this.form, fieldErrors(err));
    }
  }
}
