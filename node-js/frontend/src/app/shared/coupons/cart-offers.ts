import { inject, signal } from '@angular/core';
import { errorMessage } from '../../core/services/api-error';
import { CartService } from '../../core/services/cart.service';
import { NotificationService } from '../../core/services/notification.service';
import { CartQuote, CouponOffer } from '../models/checkout.models';
import { appliedMessage, discountLabel } from './coupon-labels';
import { formatPaise } from '../pipes/money.pipes';

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

/** What an offer saves on this cart, from the server's quote (null when the quote doesn't say). */
export function savingOnCart(
  o: Pick<CouponOffer, 'code'>,
  quote: CartQuote | null | undefined,
): { paise: number; applied: boolean } | null {
  if (!quote?.cart) return null;
  const line = quote.discounts?.find((d) => d.code === o.code);
  if (line) return { paise: line.savingPaise, applied: true };
  const option = quote.restaurantOffers?.find((r) => r.code === o.code);
  if (option) return { paise: option.savingPaise, applied: false };
  if (quote.bestCoupon?.code === o.code) return { paise: quote.bestCoupon.savingPaise, applied: false };
  return null;
}

/** minOrderLeft and highlightFor bound to a component's quote, for its template. */
export function forQuote(quote: () => CartQuote | null | undefined) {
  return {
    minOrderLeft: (o: Pick<CouponOffer, 'minOrderPaise'>) => minOrderLeft(o, quote()),
    highlight: (o: CouponOffer) => highlightFor(o, quote()),
  };
}

/** A ticket's green line: what it saves on this cart, how much more it needs, or what it gives. */
export function highlightFor(o: CouponOffer, quote: CartQuote | null | undefined): string {
  const s = savingOnCart(o, quote);
  if (s?.applied) return `You save ${formatPaise(s.paise)}`;
  if (s) return `Save ${formatPaise(s.paise)} on this order!`;
  const left = minOrderLeft(o, quote?.cart ? quote : null);
  if (left > 0) return `Add ${formatPaise(left)} more to unlock`;
  if ((o.kind ?? 'coupon') !== 'coupon') return 'No code needed';
  return `Get ${discountLabel(o)}`;
}
