import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { CatalogService } from '../../../core/services/catalog.service';
import { loaded } from '../../coupons/coupon-list';
import { OfferCard } from '../offer-card/offer-card';

/** A restaurant page's "Offers & deals": a row of its offers (hidden when it has none). */
@Component({
  selector: 'bb-offers-strip',
  imports: [OfferCard],
  templateUrl: './offers-strip.html',
  styleUrl: './offers-strip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OffersStrip {
  private readonly catalog = inject(CatalogService);
  readonly slug = input.required<string>();

  private readonly offers = rxResource({
    params: () => this.slug(),
    stream: ({ params }) => this.catalog.restaurantOffers(params),
  });
  protected readonly list = computed(() => loaded(this.offers) ?? []);
}
