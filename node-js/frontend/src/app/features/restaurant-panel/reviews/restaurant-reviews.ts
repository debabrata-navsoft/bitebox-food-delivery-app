import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { IconComponent, PaginationComponent } from 'nexprime';
import { errorMessage } from '../../../core/services/api-error';
import { ReviewService } from '../../../core/services/review.service';
import { ListEmpty } from '../../../shared/components/list-empty/list-empty';
import { FilterValue, onlyValue } from '../../../shared/components/filter-panel/filter-panel.models';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { RatingSummary } from '../../../shared/components/rating-summary/rating-summary';
import { ReviewOrderRow } from '../../../shared/components/review-order-row/review-order-row';
import { Stars } from '../../../shared/components/stars/stars';
import { datesSection, filteredList, optionsSection } from '../../../shared/list/filtered-list';
import {
  RestaurantOrderReviews,
  RATING_SECTION,
  RestaurantReviewSummary,
  SORT_OPTIONS,
} from '../../../shared/models/review.models';
import { openRestaurantOrderReviews } from './order-dialog/restaurant-order-dialog';


/** Reviews of the restaurant and its dishes, one row per order; the order dialog holds the replies. */
@Component({
  selector: 'bb-restaurant-reviews',
  imports: [
    DecimalPipe,
    ListToolbar,
    PaginationComponent,
    IconComponent,
    ListEmpty,
    PageHeader,
    RatingSummary,
    ReviewOrderRow,
    Stars,
  ],
  templateUrl: './restaurant-reviews.html',
  styleUrl: './restaurant-reviews.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestaurantReviews {
  private readonly reviews = inject(ReviewService);
  private readonly dialog = inject(BbDialog);

  protected readonly summary = signal<RestaurantReviewSummary | null>(null);
  protected readonly summaryError = signal<string | null>(null);

  protected readonly sortOptions = SORT_OPTIONS;
  private readonly dishNames = computed(
    () => new Map((this.summary()?.foods ?? []).map((f) => [f.id, f.name])),
  );
  /** The Filters panel; dishes are the ones with reviews (names from the API's counts). */
  protected readonly filterSections = computed(() => {
    const names = this.dishNames();
    return [
      optionsSection('target', 'About', { restaurant: 'The restaurant', food: 'Dishes' }),
      RATING_SECTION,
      optionsSection('reply', 'Reply', { needed: 'Needs a reply', replied: 'Replied' }),
      optionsSection('photos', 'Photos', { with: 'With photos', without: 'Without photos' }),
      optionsSection('dish', 'Dish', (id) => names.get(id) ?? 'Dish'),
      datesSection('created', 'Written'),
    ];
  });

  protected readonly reviewList = filteredList((query) => this.reviews.restaurantOrders(query), {
    errorText: 'Could not load reviews.',
    sort: 'newest',
    limit: 10,
  });
  protected readonly list = this.reviewList.list;

  protected readonly ratedFoods = computed(() =>
    (this.summary()?.foods ?? []).filter((f) => f.rating.count > 0),
  );
  /** The one dish or star rating picked (the summary cards highlight it), else none. */
  protected readonly selectedRating = computed(
    () => Number(onlyValue(this.reviewList.panel(), 'rating')) || null,
  );
  protected readonly selectedDish = computed(() => onlyValue(this.reviewList.panel(), 'dish'));

  constructor() {
    this.loadSummary();
  }

  protected loadSummary(): void {
    this.summaryError.set(null);
    this.reviews.restaurantSummary().subscribe({
      next: (s) => this.summary.set(s),
      error: (err: unknown) => this.summaryError.set(errorMessage(err, 'Could not load ratings.')),
    });
  }

  /** A shortcut from the summary cards: sets those Filters panel sections, keeps the rest. */
  protected filterBy(patch: FilterValue): void {
    this.reviewList.panel.update((v) => ({ ...v, ...patch }));
  }

  protected pickRating(stars: number | null): void {
    this.filterBy(stars ? { rating: [String(stars)], target: ['restaurant'] } : { rating: [] });
  }

  protected pickDish(id: string): void {
    this.filterBy(this.selectedDish() === id ? { dish: [] } : { dish: [id], target: ['food'] });
  }

  protected open(row: RestaurantOrderReviews): void {
    openRestaurantOrderReviews(this.dialog, row.order).subscribe(() => {
      this.list.reload();
      this.loadSummary();
    });
  }
}
