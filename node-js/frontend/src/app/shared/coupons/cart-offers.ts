import { inject, signal } from '@angular/core';
import { errorMessage } from '../../core/services/api-error';
import { CartService } from '../../core/services/cart.service';
import { NotificationService } from '../../core/services/notification.service';
import { CartQuote, CouponOffer } from '../models/checkout.models';
import { appliedMessage } from './coupon-labels';

/** How much more the cart needs before this offer applies (0: it can be used, or no cart). */
export const minOrderLeft = (o: Pick<CouponOffer, 'minOrderPaise'>, quote: CartQuote | null | undefined): number =>
  quote ? Math.max(0, o.minOrderPaise - quote.pricing.subtotalPaise) : 0;

/**
 * Applies a coupon, or a restaurant offer instead of the best one, to the cart: marks that code
 * busy, then says what it saves (or why it can't). The server checks everything. Call in an
 * injection context.
 */
export function codeApplier() {
  const cart = inject(CartService);
  const notify = inject(NotificationService);
  const busy = signal<string | null>(null);
  const apply = (code: string): void => {
    busy.set(code);
    cart.applyCoupon(code).subscribe({
      next: (quote) => {
        busy.set(null);
        notify.success(appliedMessage(quote, code.toUpperCase()));
      },
      error: (err: unknown) => {
        busy.set(null);
        notify.error(errorMessage(err));
      },
    });
  };
  return { busy: busy.asReadonly(), apply };
}
