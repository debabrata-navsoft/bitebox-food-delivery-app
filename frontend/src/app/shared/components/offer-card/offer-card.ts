import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { discountLabel, discountParts, itemsLabel } from '../../coupons/coupon-labels';
import { CouponOffer } from '../../models/checkout.models';
import { InrPipe } from '../../pipes/money.pipes';

/**
 * One offer as customers see it: the discount on an amber side panel, the title, the
 * conditions and the code as a tag. Actions (an "Apply" button) go in the content slot.
 */
@Component({
  selector: 'bb-offer-card',
  imports: [InrPipe],
  templateUrl: './offer-card.html',
  styleUrl: './offer-card.scss',
  host: { '[class.locked]': 'locked()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfferCard {
  readonly offer = input.required<CouponOffer>();
  /** Greyed out, e.g. while the cart is below the minimum order. */
  readonly locked = input(false);

  /** The side panel: "20%" / "OFF", "₹50" / "OFF" or "FREE" / "DELIVERY". */
  protected readonly side = computed(() => discountParts(this.offer()));
  protected readonly discount = computed(() => discountLabel(this.offer()));
  protected readonly title = computed(() => this.offer().name || this.offer().description || this.discount());
  protected readonly items = computed(() => itemsLabel(this.offer()));
}
