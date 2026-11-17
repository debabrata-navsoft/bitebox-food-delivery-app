import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormRoot, form, pattern } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { ButtonComponent, IconComponent } from 'nexprime';
import { CartService } from '../../../core/services/cart.service';
import { errorMessage } from '../../../core/services/api-error';
import { NotificationService } from '../../../core/services/notification.service';
import {
  BB_DIALOG_DATA,
  BbDialog,
  BbDialogRef,
  BbDialogTitle,
} from '../../../shared/dialog/bb-dialog';
import { shownError } from '../../../shared/forms/form-errors';
import { NP_FORM_FIELDS } from '../../../shared/forms/np-form-fields';
import { CartQuote, CouponOffer } from '../../../shared/models/checkout.models';
import { InrPipe } from '../../../shared/pipes/money.pipes';
import { OfferCard } from '../../../shared/components/offer-card/offer-card';
import { appliedMessage } from '../../../shared/coupons/coupon-labels';
import { minOrderLeft } from '../../../shared/coupons/cart-offers';

/**
 * Every coupon for this cart: a code box and the available offers. An offer below its minimum order
 * is shown but cannot be applied. Applying closes the dialog with the new quote.
 */
@Component({
  selector: 'bb-coupon-dialog',
  imports: [FormRoot, NP_FORM_FIELDS, MatButtonModule, ButtonComponent, IconComponent, InrPipe, BbDialogTitle, OfferCard],
  templateUrl: './coupon-dialog.html',
  styleUrl: './coupon-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CouponDialog {
  protected readonly offers = inject<CouponOffer[]>(BB_DIALOG_DATA);
  protected readonly ref = inject<BbDialogRef<CartQuote>>(BbDialogRef);
  private readonly cart = inject(CartService);
  private readonly notify = inject(NotificationService);

  protected readonly shownError = shownError;
  protected readonly error = signal<string | null>(null);
  protected readonly applying = signal(false);
  /** The server's pick: the coupon that saves most on this cart. */
  protected readonly best = computed(() => this.cart.quote()?.bestCoupon ?? null);
  /** The restaurant's offers for this cart: one is applied, the others can replace it. */
  protected readonly restaurantOffers = computed(() => this.cart.quote()?.restaurantOffers ?? []);
  private readonly codeModel = signal({ code: '' });
  protected readonly codeForm = form(
    this.codeModel,
    (path) =>
      pattern(path.code, /^\s*[A-Za-z0-9_-]{3,30}\s*$/, {
        message: 'Coupon codes are 3-30 letters or digits',
      }),
    { submission: { action: async () => this.apply(this.codeModel().code) } },
  );

  /** How much more the cart needs before this offer applies (0: it can be used now). */
  protected minOrderLeft(o: CouponOffer): number {
    return minOrderLeft(o, this.cart.quote());
  }

  protected apply(code: string): void {
    const value = code.trim();
    if (!value) return;
    this.applying.set(true);
    this.error.set(null);
    this.cart.applyCoupon(value).subscribe({
      next: (quote) => {
        this.notify.success(appliedMessage(quote, value.toUpperCase()));
        this.ref.close(quote);
      },
      error: (err: unknown) => {
        this.error.set(errorMessage(err));
        this.applying.set(false);
      },
    });
  }
}

/** Opens the coupons dialog; emits the quote once a coupon is applied (nothing when closed). */
export const openCoupons = (dialog: BbDialog, offers: CouponOffer[]) =>
  dialog.result<CouponDialog, CouponOffer[], CartQuote>(CouponDialog, { data: offers, width: '480px' });
