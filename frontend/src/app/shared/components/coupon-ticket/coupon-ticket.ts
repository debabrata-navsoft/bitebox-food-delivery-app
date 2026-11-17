import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { describe, discountParts } from '../../coupons/coupon-labels';
import { CouponOffer } from '../../models/checkout.models';

/**
 * A coupon as a ticket (the Offers page): the discount down a coloured side strip, the code or
 * name with an action on the right (content slot `[ticketAction]`), a highlight line, the offer
 * in a sentence, and its terms behind "+ MORE".
 */
@Component({
  selector: 'bb-coupon-ticket',
  templateUrl: './coupon-ticket.html',
  styleUrl: './coupon-ticket.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': '"kind-" + (offer().kind ?? "coupon")', '[class.locked]': 'locked()' },
})
export class CouponTicket {
  readonly offer = input.required<CouponOffer>();
  /** The green line under the title: "Save ₹100 on this order!". */
  readonly highlight = input<string | null>(null);
  /** Greyed out (e.g. below the minimum order). */
  readonly locked = input(false);

  protected readonly side = computed(() => {
    const { big, small } = discountParts(this.offer());
    return `${big} ${small}`;
  });
  protected readonly title = computed(() => {
    const o = this.offer();
    return (o.kind ?? 'coupon') === 'coupon' ? o.code : o.name || o.description || this.side();
  });
  protected readonly sentence = computed(() => describe(this.offer()));
  protected readonly more = signal(false);
}
