import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IconComponent } from 'nexprime';
import { CartService } from '../../../core/services/cart.service';
import { CatalogService } from '../../../core/services/catalog.service';
import { codeApplier, forQuote } from '../../coupons/cart-offers';
import { loaded } from '../../coupons/coupon-list';
import { CouponTicket } from '../coupon-ticket/coupon-ticket';

/**
 * A restaurant page's "Offers & deals": its own offers as tickets in a row, and a link to every offer.
 * Only one restaurant offer applies to an order. With this restaurant's dishes in the cart, the
 * applied one says so and the others can be applied instead (the server checks each).
 */
@Component({
  selector: 'bb-offers-strip',
  imports: [CouponTicket, RouterLink, IconComponent],
  templateUrl: './offers-strip.html',
  styleUrl: './offers-strip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OffersStrip {
  private readonly catalog = inject(CatalogService);
  protected readonly cart = inject(CartService);
  readonly slug = input.required<string>();
  private readonly applier = codeApplier();
  protected readonly applying = this.applier.busy;
  protected readonly apply = this.applier.apply;

  private readonly offers = rxResource({
    params: () => this.slug(),
    stream: ({ params }) => this.catalog.restaurantOffers(params),
  });
  /** Only the restaurant's own offers; BiteBox coupons and offers are on the Offers page. */
  protected readonly list = computed(() =>
    (loaded(this.offers) ?? []).filter((o) => o.kind === 'restaurant_offer'),
  );

  /** The cart's quote, when it holds this restaurant's dishes (offers only apply to those). */
  private readonly quote = computed(() => {
    const q = this.cart.quote();
    return q?.cart?.restaurant?.slug === this.slug() ? q : null;
  });
  protected readonly inCart = computed(() => !!this.quote());
  /** The offers usable on this cart, by code (the server's list; one is `applied`). */
  protected readonly options = computed(
    () => new Map((this.quote()?.restaurantOffers ?? []).map((o) => [o.code, o])),
  );

  protected readonly minOrderLeft = forQuote(this.quote).minOrderLeft;
  /** "You save ₹60", "Save ₹60 on this order!", "Add ₹80 more to unlock" or "No code needed". */
  protected readonly highlight = forQuote(this.quote).highlight;
}
