import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Subscription, catchError, debounceTime, distinctUntilChanged, of } from 'rxjs';
import { CatalogService } from '../../../core/services/catalog.service';
import { errorMessage } from '../../../core/services/api-error';
import { MatDialog } from '@angular/material/dialog';
import { DeliveryLocationService } from '../../../core/services/delivery-location.service';
import { LocationPickerDialog } from '../../../shared/components/location-picker/location-picker-dialog';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { RestaurantCard } from '../../../shared/components/restaurant-card/restaurant-card';
import { Pagination } from '../../../shared/models/api.models';
import { Restaurant, RestaurantQuery, RestaurantSort } from '../../../shared/models/catalog.models';

const SORT_LABELS: Record<RestaurantSort, string> = {
  rating: 'Top rated',
  fastest: 'Fastest prep',
  costLow: 'Cost: low to high',
  costHigh: 'Cost: high to low',
  newest: 'Newest',
  distance: 'Nearest',
};

/**
 * Restaurant discovery. All filters live in the URL query string, so results
 * are shareable and survive refresh / back navigation.
 */
@Component({
  selector: 'bb-restaurant-list',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    EmptyState,
    RestaurantCard,
  ],
  templateUrl: './restaurant-list.html',
  styleUrl: './restaurant-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestaurantList {
  private readonly catalog = inject(CatalogService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  protected readonly deliveryLocation = inject(DeliveryLocationService).location;

  // Query params (bound via withComponentInputBinding)
  readonly search = input<string>();
  readonly cuisine = input<string>();
  readonly category = input<string>();
  readonly veg = input<string>();
  readonly sort = input<RestaurantSort>();
  readonly lat = input<string>();
  readonly lng = input<string>();
  /** ?all=true ignores the saved delivery location and lists every restaurant. */
  readonly all = input<string>();

  protected readonly categories = toSignal(this.catalog.categories().pipe(catchError(() => of([]))), { initialValue: [] });
  protected readonly cuisines = toSignal(this.catalog.cuisines().pipe(catchError(() => of([]))), { initialValue: [] });
  protected readonly sortOptions = computed(() =>
    (Object.keys(SORT_LABELS) as RestaurantSort[])
      .filter((s) => s !== 'distance' || this.nearby())
      .map((value) => ({ value, label: SORT_LABELS[value] })),
  );

  protected readonly searchControl = new FormControl('', { nonNullable: true });
  protected readonly restaurants = signal<Restaurant[]>([]);
  protected readonly pagination = signal<Pagination | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal<string | null>(null);
  /**
   * Coordinates to search around: explicit ?lat&lng in the URL, otherwise the
   * delivery location chosen in the header (unless ?all=true).
   */
  protected readonly coords = computed(() => {
    if (this.lat() !== undefined && this.lng() !== undefined) {
      return { latitude: Number(this.lat()), longitude: Number(this.lng()), label: 'the selected point' };
    }
    const loc = this.deliveryLocation();
    return loc && this.all() !== 'true' ? { latitude: loc.latitude, longitude: loc.longitude, label: loc.label } : null;
  });
  protected readonly nearby = computed(() => this.coords() !== null);
  protected readonly vegOnly = computed(() => this.veg() === 'true');
  protected readonly hasFilters = computed(
    () => !!(this.search() || this.cuisine() || this.category() || this.vegOnly()),
  );
  protected readonly canLoadMore = computed(() => {
    const p = this.pagination();
    return !!p && p.page < p.totalPages;
  });

  private inFlight?: Subscription;

  private readonly query = computed<RestaurantQuery>(() => ({
    search: this.search() || undefined,
    cuisine: this.cuisine() || undefined,
    category: this.category() || undefined,
    veg: this.vegOnly() || undefined,
    sort: this.sort() || undefined,
    lat: this.coords()?.latitude,
    lng: this.coords()?.longitude,
    limit: 12,
  }));

  constructor() {
    // Reload whenever the URL filters change.
    effect(() => {
      const query = this.query();
      untracked(() => {
        this.searchControl.setValue(query.search ?? '', { emitEvent: false });
        this.load(query, 1);
      });
    });

    this.searchControl.valueChanges
      .pipe(debounceTime(400), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((search) => this.setParams({ search: search.trim() || null }));
  }

  protected setParams(params: Record<string, string | number | boolean | null>): void {
    void this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected toggleCategory(id: string): void {
    this.setParams({ category: this.category() === id ? null : id });
  }

  protected clearFilters(): void {
    // Keep "show all" if it was chosen; clearing filters should not silently re-apply the location.
    void this.router.navigate([], { queryParams: this.all() === 'true' ? { all: 'true' } : {}, replaceUrl: true });
  }

  protected chooseLocation(): void {
    this.dialog
      .open(LocationPickerDialog, { width: '520px', maxWidth: '95vw', autoFocus: 'first-tabbable' })
      .afterClosed()
      .subscribe((changed) => {
        if (changed) this.setParams({ all: null, lat: null, lng: null });
      });
  }

  /** Show every restaurant regardless of the delivery location. */
  protected showAll(): void {
    this.setParams({ all: 'true', lat: null, lng: null, sort: this.sort() === 'distance' ? null : (this.sort() ?? null) });
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
    // A newer search supersedes any request still in flight (avoids stale results winning).
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
