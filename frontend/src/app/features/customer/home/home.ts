import { NpIconPipe } from '../../../shared/icons/np-icon-name';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { FormRoot, form, validate } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { IconComponent } from 'nexprime';
import { Observable, Subscription, catchError, map, of, timeout } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { CartActions } from '../../../core/services/cart-actions.service';
import { CatalogService } from '../../../core/services/catalog.service';
import { OrderService } from '../../../core/services/checkout-api.service';
import { DeliveryLocationService } from '../../../core/services/delivery-location.service';
import { ReviewService } from '../../../core/services/review.service';
import { RewardsService } from '../../../core/services/rewards.service';
import { LocationPickerDialog } from '../../../shared/components/location-picker/location-picker-dialog';
import { RestaurantCard } from '../../../shared/components/restaurant-card/restaurant-card';
import { APP_LINKS, available } from '../../../shared/components/site-footer/footer-links';
import { Stars } from '../../../shared/components/stars/stars';
import { DishSearchResult, FoodCategory, Restaurant } from '../../../shared/models/catalog.models';
import { CouponOffer } from '../../../shared/models/checkout.models';
import { FeaturedReview } from '../../../shared/models/review.models';
import { CoinWallet } from '../../../shared/models/rewards.models';
import { NP_FORM_FIELDS } from '../../../shared/forms/np-form-fields';
import { InrPipe } from '../../../shared/pipes/money.pipes';

/** A list loaded in the browser; on error the section simply stays hidden. */
const quietly = <T>(source: Observable<T[]>) => source.pipe(catchError(() => of([] as T[])));

@Component({
  selector: 'bb-home',
  imports: [
    DatePipe,
    FormRoot,
    NP_FORM_FIELDS,
    RouterLink,
    MatButtonModule,
    IconComponent,
    NpIconPipe,
    RestaurantCard,
    Stars,
    InrPipe,
  ],
  templateUrl: './home.html',
  styleUrl: './home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  private readonly catalog = inject(CatalogService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  protected readonly cartActions = inject(CartActions);
  protected readonly user = this.auth.displayUser;
  protected readonly sessionChecked = this.auth.initialised;
  protected readonly deliveryLocation = inject(DeliveryLocationService).location;
  /** A signed-in customer (confirmed by the server, not the display hint): may load coins and coupons. */
  private readonly customer = computed(() => this.auth.user()?.role === 'customer');

  protected readonly searchForm = form(
    signal({ search: '' }),
    (path) =>
      validate(path.search, ({ value }) => (value().trim() ? undefined : { kind: 'required' })),
    { submission: { action: async () => this.submitSearch() } },
  );

  protected readonly categories = signal<FoodCategory[] | null>(null);
  protected readonly restaurants = signal<Restaurant[]>([]);
  protected readonly loaded = signal<boolean | null>(null);
  protected readonly dishes = signal<DishSearchResult[] | null>(null);
  protected readonly reviews = signal<FeaturedReview[]>([]);
  protected readonly coupons = signal<CouponOffer[]>([]);
  protected readonly wallet = signal<CoinWallet | null>(null);
  private restaurantsRequest?: Subscription;

  /** Category photos (added by admins) for the banner; the illustration shows until there are some. */
  protected readonly bannerPhotos = computed(() =>
    (this.categories() ?? []).filter((c) => c.imageUrl).slice(0, 3),
  );
  /** The banner's offer card: the customer's first live coupon, if any. */
  protected readonly featuredCoupon = computed(() => this.coupons()[0] ?? null);
  protected readonly appLinks = available(APP_LINKS);

  /** The home page shows the first few categories; "View all" reveals the rest. */
  protected readonly categoryLimit = 9;
  protected readonly showAllCategories = signal(false);
  protected readonly visibleCategories = computed(() => {
    const all = this.categories() ?? [];
    return this.showAllCategories() ? all : all.slice(0, this.categoryLimit);
  });

  constructor() {
    const browser = isPlatformBrowser(inject(PLATFORM_ID));
    this.catalog
      .categories()
      .pipe(browser ? (source) => source : timeout(2000))
      .subscribe({
        next: (c) => this.categories.set(c),
        error: () => browser && this.categories.set([]),
      });
    if (!browser) return;

    quietly(this.catalog.dishes({ limit: 6 }).pipe(map((res) => res.items))).subscribe((d) => this.dishes.set(d));
    quietly(inject(ReviewService).featured()).subscribe((r) => this.reviews.set(r.slice(0, 4)));

    // Coins and coupons belong to a signed-in customer; cleared on sign-out.
    const orders = inject(OrderService);
    const rewards = inject(RewardsService);
    effect(() => {
      const signedIn = this.customer();
      untracked(() => {
        this.coupons.set([]);
        this.wallet.set(null);
        if (!signedIn) return;
        quietly(orders.availableCoupons()).subscribe((c) => this.coupons.set(c));
        rewards.wallet().subscribe({ next: (w) => this.wallet.set(w.wallet), error: () => undefined });
      });
    });

    effect(() => {
      const location = this.deliveryLocation();
      untracked(() => {
        this.restaurantsRequest?.unsubscribe();
        this.loaded.set(null);
        this.restaurantsRequest = this.catalog
          .restaurants(
            location
              ? { lat: location.latitude, lng: location.longitude, sort: 'distance', limit: 8 }
              : { sort: 'rating', limit: 8 },
          )
          .subscribe({
            next: (res) => {
              this.restaurants.set(res.items);
              this.loaded.set(true);
            },
            error: () => this.loaded.set(false),
          });
      });
    });
  }

  protected chooseLocation(): void {
    this.dialog.open(LocationPickerDialog, {
      width: '520px',
      maxWidth: '95vw',
      autoFocus: 'first-tabbable',
    });
  }

  protected focusIfEmpty(event: Event): void {
    if (this.searchForm().invalid()) {
      (event.currentTarget as HTMLFormElement).querySelector('input')?.focus();
    }
  }

  private submitSearch(): void {
    void this.router.navigate(['/restaurants'], {
      queryParams: { search: this.searchForm.search().value().trim() },
    });
  }

  protected offerTitle(o: CouponOffer): string {
    return o.discountType === 'percent' ? `${o.discountValue}% OFF` : `₹${o.discountValue / 100} OFF`;
  }

  /** Always-on rewards cards (signed-out visitors are sent to sign up). */
  protected readonly rewardCards = [
    {
      title: 'Refer & earn',
      text: 'Invite friends. You both earn coins when their first order is delivered.',
      icon: 'gift',
      link: '/account/refer',
      tone: 'refer',
    },
    {
      title: 'BiteBox coins',
      text: 'Earn coins on every delivered order and use them at checkout.',
      icon: 'coins',
      link: '/account/coins',
      tone: 'coins',
    },
  ];

  /** Partner sign-up banners (visitors only). */
  protected readonly partnerCards = [
    {
      kind: 'restaurant',
      title: 'Grow your restaurant business with BiteBox',
      text: 'Reach more hungry customers and manage your menu and orders from one dashboard.',
      cta: 'Become a restaurant partner',
      register: '/restaurant/register',
      signIn: 'Partner sign in',
      icon: 'store',
    },
    {
      kind: 'rider',
      title: 'Earn with BiteBox',
      text: 'Join our delivery team and earn on your own time.',
      cta: 'Become a delivery partner',
      register: '/delivery/register',
      signIn: 'Rider sign in',
      icon: 'bike',
    },
  ];

  protected readonly steps = [
    { icon: 'store', title: 'Explore', text: 'Find your favourite restaurants' },
    { icon: 'shopping-bag', title: 'Order', text: 'Choose your food and place your order' },
    { icon: 'bike', title: 'Enjoy', text: 'Track it live to your doorstep' },
  ];
}
