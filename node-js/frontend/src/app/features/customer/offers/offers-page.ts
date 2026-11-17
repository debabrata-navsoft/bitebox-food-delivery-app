import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonToggleComponent, SelectComponent, IconComponent } from 'nexprime';
import { CartService } from '../../../core/services/cart.service';
import { OrderService } from '../../../core/services/checkout-api.service';
import { NotificationService } from '../../../core/services/notification.service';
import { CouponTicket } from '../../../shared/components/coupon-ticket/coupon-ticket';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { codeApplier, forQuote, savingOnCart } from '../../../shared/coupons/cart-offers';
import { placeOf } from '../../../shared/coupons/coupon-labels';
import { loaded } from '../../../shared/coupons/coupon-list';
import { CouponOffer, OfferKind } from '../../../shared/models/checkout.models';

type Action = { label: 'APPLY' | 'APPLIED' | 'COPY' | 'VIEW'; slug?: string } | null;

/**
 * Every offer the customer can use right now: the best coupon first, then restaurant offers, then
 * the rest. With a cart, savings come from the server's quote and coupons can be applied here.
 */
@Component({
  selector: 'bb-offers-page',
  imports: [RouterLink, ButtonToggleComponent, SelectComponent, IconComponent, EmptyState, CouponTicket, PageHeader],
  templateUrl: './offers-page.html',
  styleUrl: './offers-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OffersPage {
  private readonly api = inject(OrderService);
  private readonly cart = inject(CartService);
  private readonly notify = inject(NotificationService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly kinds = [
    { value: '', label: 'All' },
    { value: 'coupon', label: 'Coupons' },
    { value: 'restaurant', label: 'Restaurant offers' },
    { value: 'payment', label: 'Payment offers' },
    { value: 'free_delivery', label: 'Free delivery' },
    { value: 'first_order', label: 'First order' },
  ];
  protected readonly kind = signal('');
  private readonly applier = codeApplier();
  protected readonly busy = this.applier.busy;

  protected readonly offers = rxResource({
    params: () => this.kind(),
    stream: ({ params }) => this.api.offers((params || undefined) as OfferKind | undefined),
  });
  protected readonly list = computed(() => loaded(this.offers));
  protected readonly loading = this.offers.isLoading;
  protected readonly failed = computed(() => this.offers.status() === 'error');

  /** The cart's quote, when it has dishes (savings and Apply come from it). */
  private readonly quote = computed(() => (this.cart.quote()?.cart ? this.cart.quote() : null));

  /** The best coupon (the server's pick for this cart, else the top one), restaurant offers, the rest. */
  protected readonly sections = computed(() => {
    const all = this.list() ?? [];
    const coupons = all.filter((o) => (o.kind ?? 'coupon') === 'coupon');
    const best = coupons.find((o) => o.code === this.quote()?.bestCoupon?.code) ?? coupons[0];
    return [
      { title: 'Best coupon', items: best ? [best] : [] },
      { title: 'Restaurant offers', items: all.filter((o) => o.kind === 'restaurant_offer') },
      { title: 'More offers', items: all.filter((o) => o !== best && o.kind !== 'restaurant_offer') },
    ].filter((s) => s.items.length);
  });

  protected pick(value: string | string[] | null): void {
    this.kind.set(typeof value === 'string' ? value : '');
  }

  protected readonly minOrderLeft = forQuote(this.quote).minOrderLeft;
  protected readonly highlight = forQuote(this.quote).highlight;

  protected action(o: CouponOffer): Action {
    const s = savingOnCart(o, this.quote());
    if (s?.applied) return { label: 'APPLIED' };
    const kind = o.kind ?? 'coupon';
    if (kind === 'coupon') return this.quote() ? { label: 'APPLY' } : { label: 'COPY' };
    if (kind === 'restaurant_offer') {
      if (s) return { label: 'APPLY' };
      const slug = placeOf(o).slug;
      return slug ? { label: 'VIEW', slug } : null;
    }
    return null; // platform and payment offers apply by themselves
  }

  protected act(o: CouponOffer, label: string): void {
    if (label === 'COPY') {
      if (this.browser) void navigator.clipboard?.writeText(o.code);
      this.notify.success(`Code ${o.code} copied. Use it at checkout.`);
      return;
    }
    this.applier.apply(o.code);
  }
}
