import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { form } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { Subscription, catchError, debounceTime, distinctUntilChanged, of } from 'rxjs';
import { CatalogService } from '../../../../core/services/catalog.service';
import { errorMessage } from '../../../../shared/utils/api-error';
import { MatDialog } from '@angular/material/dialog';
import { DeliveryLocationService } from '../../../../core/services/delivery-location.service';
import { LocationPickerDialog } from '../../../../shared/components/location-picker/location-picker-dialog';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { RestaurantCard } from '../../../../shared/components/restaurant-card/restaurant-card';
import { Pagination } from '../../../../core/models/api.models';
import {
  Restaurant,
  RestaurantQuery,
  RestaurantSort,
} from '../../../../core/models/catalog.models';
import { BbDialog } from '../../../../shared/dialog/bb-dialog';
import {
  CostBand,
  COST_BANDS,
  RestaurantFilters,
  SORT_LABELS,
  activeCount,
  toParams,
  toQuery,
} from '../restaurant-filters/restaurant-filters';
import { openFilters } from '../restaurant-filters/filters-dialog/filters-dialog';

import { IconComponent } from 'nexprime';
import { NP_FORM_FIELDS } from '../../../../shared/forms/np-form-fields';

@Component({
  selector: 'bb-restaurant-list',
  imports: [NP_FORM_FIELDS, RouterLink, MatButtonModule, IconComponent, EmptyState, RestaurantCard],
  templateUrl: './restaurant-list.html',
  styleUrl: './restaurant-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestaurantList {
  private readonly catalog = inject(CatalogService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly bbDialog = inject(BbDialog);
  private readonly locations = inject(DeliveryLocationService);
  protected readonly deliveryLocation = this.locations.location;

  readonly search = input<string>();
  readonly cuisine = input<string>();
  readonly category = input<string>();
  readonly veg = input<string>();
  readonly sort = input<RestaurantSort>();
  readonly rating = input<string>();
  readonly cost = input<string>();
  readonly open = input<string>();
  readonly offers = input<string>();
  readonly lat = input<string>();
  readonly lng = input<string>();
  readonly all = input<string>();

  protected readonly categories = toSignal(
    this.catalog.categories().pipe(catchError(() => of([]))),
    { initialValue: [] },
  );
  protected readonly cuisines = toSignal(this.catalog.cuisines().pipe(catchError(() => of([]))), {
    initialValue: [],
  });

  protected readonly filters = form(signal({ search: '' }));
  protected readonly restaurants = signal<Restaurant[]>([]);
  protected readonly pagination = signal<Pagination | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly coords = computed(() => {
    if (this.lat() !== undefined && this.lng() !== undefined) {
      return {
        latitude: Number(this.lat()),
        longitude: Number(this.lng()),
        label: 'the selected point',
      };
    }
    const loc = this.deliveryLocation();
    return loc && this.all() !== 'true'
      ? { latitude: loc.latitude, longitude: loc.longitude, label: loc.label }
      : null;
  });
  protected readonly nearby = computed(() => this.coords() !== null);
  /** The filters from the URL (sort, cuisines, rating, cost, veg, open now, offers). */
  protected readonly picked = computed<RestaurantFilters>(() => ({
    sort: this.sort() ?? null,
    category: this.category() ?? null,
    cuisines: (this.cuisine() ?? '').split(',').filter(Boolean),
    minRating: Number(this.rating()) || null,
    cost: this.cost() && this.cost()! in COST_BANDS ? (this.cost() as CostBand) : null,
    veg: this.veg() === 'true',
    openNow: this.open() === 'true',
    offers: this.offers() === 'true',
  }));
  protected readonly activeFilters = computed(() => activeCount(this.picked()));
  protected readonly sortLabel = computed(
    () => SORT_LABELS[this.picked().sort ?? (this.nearby() ? 'distance' : 'rating')],
  );
  /** One-tap chips that switch a common filter on or off. */
  protected readonly quickChips = computed(() => {
    const f = this.picked();
    const rated = f.minRating === 4;
    return [
      { label: 'Offers', icon: 'badge-percent', on: f.offers, change: { offers: !f.offers } },
      { label: 'Rating 4.0+', icon: 'star', on: rated, change: { minRating: rated ? null : 4 } },
      { label: 'Pure veg', icon: 'leaf', on: f.veg, change: { veg: !f.veg } },
      { label: 'Open now', icon: 'clock', on: f.openNow, change: { openNow: !f.openNow } },
    ];
  });
  /** What was picked in the dialog (category, cost, each cuisine), each removable with ×. */
  protected readonly removable = computed(() => {
    const f = this.picked();
    const category = this.categories().find((c) => c.id === f.category)?.name;
    const chips: { label: string; change: Partial<RestaurantFilters> }[] = f.cuisines.map((c) => ({
      label: c,
      change: { cuisines: f.cuisines.filter((x) => x !== c) },
    }));
    if (f.cost) chips.unshift({ label: COST_BANDS[f.cost].label, change: { cost: null } });
    if (category) chips.unshift({ label: category, change: { category: null } });
    return chips;
  });
  protected readonly hasFilters = computed(() => !!(this.search() || this.activeFilters()));
  protected readonly canLoadMore = computed(() => {
    const p = this.pagination();
    return !!p && p.page < p.totalPages;
  });

  private inFlight?: Subscription;

  private readonly query = computed<RestaurantQuery>(() => ({
    search: this.search() || undefined,
    ...toQuery(this.picked()),
    lat: this.coords()?.latitude,
    lng: this.coords()?.longitude,
    limit: 12,
  }));

  constructor() {
    effect(() => {
      if (!this.locations.ready()) return; // wait for the saved location: one request, not two
      const query = this.query();
      untracked(() => {
        const box = this.filters.search().value;
        if (box().trim() !== (query.search ?? '')) box.set(query.search ?? '');
        this.load(query, 1);
      });
    });

    toObservable(computed(() => this.filters.search().value().trim()))
      .pipe(debounceTime(400), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((search) => {
        if (search !== (this.search() ?? '')) this.setParams({ search: search || null });
      });
  }

  protected setParams(params: Record<string, string | number | boolean | null>): void {
    void this.router.navigate([], {
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** A quick chip: switches one filter on or off. */
  protected quick(change: Partial<RestaurantFilters>): void {
    this.setParams(toParams({ ...this.picked(), ...change }));
  }

  /** The full filters (tabs: sort, cuisines, rating, cost, more); applied on Apply. */
  protected showFilters(tab?: 'sort'): void {
    openFilters(this.bbDialog, {
      filters: this.picked(),
      cuisines: this.cuisines(),
      categories: this.categories(),
      nearby: this.nearby(),
      tab,
    }).subscribe((filters) => this.setParams(toParams(filters)));
  }

  protected clearFilters(): void {
    void this.router.navigate([], {
      queryParams: this.all() === 'true' ? { all: 'true' } : {},
      replaceUrl: true,
    });
  }

  protected chooseLocation(): void {
    this.dialog
      .open(LocationPickerDialog, { width: '520px', maxWidth: '95vw', autoFocus: 'first-tabbable' })
      .afterClosed()
      .subscribe((changed) => {
        if (changed) this.setParams({ all: null, lat: null, lng: null });
      });
  }

  protected showAll(): void {
    this.setParams({
      all: 'true',
      lat: null,
      lng: null,
      sort: this.sort() === 'distance' ? null : (this.sort() ?? null),
    });
  }

  protected loadMore(): void {
    const p = this.pagination();
    if (p) this.load(this.query(), p.page + 1);
  }

  protected retry(): void {
    this.load(this.query(), 1);
  }

  private load(query: RestaurantQuery, page: number): void {
    const append = page > 1;
    this.inFlight?.unsubscribe();
    (append ? this.loadingMore : this.loading).set(true);
    this.error.set(null);
    this.inFlight = this.catalog.restaurants({ ...query, page }).subscribe({
      next: (res) => {
        this.restaurants.update((current) => (append ? [...current, ...res.items] : res.items));
        this.pagination.set(res.pagination);
        this.loading.set(false);
        this.loadingMore.set(false);
      },
      error: (err: unknown) => {
        this.error.set(errorMessage(err, 'Could not load restaurants.'));
        this.loading.set(false);
        this.loadingMore.set(false);
      },
    });
  }
}
