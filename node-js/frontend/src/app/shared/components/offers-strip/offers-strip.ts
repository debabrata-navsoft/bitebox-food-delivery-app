import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IconComponent } from 'nexprime';
import { CartService } from '../../../core/services/cart.service';
import { CatalogService } from '../../../core/services/catalog.service';
import { codeApplier, minOrderLeft } from '../../coupons/cart-offers';
import { loaded } from '../../coupons/coupon-list';
import { CouponOffer } from '../../models/checkout.models';
import { InrPipe } from '../../pipes/money.pipes';
import { OfferCard } from '../offer-card/offer-card';

/**
 * A restaurant page's "Offers & deals": its own offers in a row, and a link to every offer.
 * Only one restaurant offer applies to an order. With this restaurant's dishes in the cart, the
 * applied one says so and the others can be applied instead (the server checks each).
 */
@Component({
  selector: 'bb-offers-strip',
  imports: [OfferCard, RouterLink, IconComponent, InrPipe],
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
  protected readonly apply = (o: CouponOffer) => this.applier.apply(o.code);

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
  private readonly options = computed(
    () => new Map((this.quote()?.restaurantOffers ?? []).map((o) => [o.code, o])),
  );

  protected applied(o: CouponOffer): boolean {
    return !!this.options().get(o.code)?.applied;
  }

  /** Usable on this cart (the server's list), so it can replace the applied one. */
  protected canApply(o: CouponOffer): boolean {
    return this.options().has(o.code) && !this.applied(o);
  }

  protected minOrderLeft(o: CouponOffer): number {
    return minOrderLeft(o, this.quote());
  }
}
