import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonToggleComponent, IconComponent } from 'nexprime';
import { OrderService } from '../../../core/services/checkout-api.service';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { OfferCard } from '../../../shared/components/offer-card/offer-card';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { loaded } from '../../../shared/coupons/coupon-list';
import { OfferKind } from '../../../shared/models/checkout.models';
import { placeOf } from '../../../shared/coupons/coupon-labels';

/** Every offer the customer can use right now, best first, filtered by kind. */
@Component({
  selector: 'bb-offers-page',
  imports: [RouterLink, ButtonToggleComponent, IconComponent, EmptyState, OfferCard, PageHeader],
  templateUrl: './offers-page.html',
  styleUrl: './offers-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OffersPage {
  private readonly api = inject(OrderService);
  protected readonly placeOf = placeOf;
  protected readonly kinds = [
    { value: '', label: 'All' },
    { value: 'percent', label: '% off' },
    { value: 'flat', label: 'Flat ₹ off' },
    { value: 'free_delivery', label: 'Free delivery' },
    { value: 'first_order', label: 'First order' },
    { value: 'restaurant', label: 'Restaurant offers' },
    { value: 'category', label: 'On dishes' },
  ];
  protected readonly kind = signal('');

  protected readonly offers = rxResource({
    params: () => this.kind(),
    stream: ({ params }) => this.api.offers((params || undefined) as OfferKind | undefined),
  });
  protected readonly list = computed(() => loaded(this.offers));
  protected readonly loading = this.offers.isLoading;
  protected readonly failed = computed(() => this.offers.status() === 'error');

  protected pick(value: string | string[] | null): void {
    this.kind.set(typeof value === 'string' ? value : '');
  }
}
