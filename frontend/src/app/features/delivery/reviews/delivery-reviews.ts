import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { ButtonComponent, IconComponent, PaginationComponent } from 'nexprime';
import { NotificationService } from '../../../core/services/notification.service';
import { ReviewService } from '../../../core/services/review.service';
import { ListEmpty } from '../../../shared/components/list-empty/list-empty';
import { onlyValue } from '../../../shared/components/filter-panel/filter-panel.models';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { RatingSummary } from '../../../shared/components/rating-summary/rating-summary';
import { reportReview } from '../../../shared/components/report-review-dialog/report-review-dialog';
import { ReviewCard } from '../../../shared/components/review-card/review-card';
import { datesSection, filteredList, optionsSection } from '../../../shared/list/filtered-list';
import { RATING_SECTION, RiderReview, SORT_OPTIONS } from '../../../core/models/review.models';

/** The rider's delivery ratings. Read-only: riders can report a review but never change it. */
@Component({
  selector: 'bb-delivery-reviews',
  imports: [
    ButtonComponent,
    PaginationComponent,
    IconComponent,
    ListEmpty,
    ListToolbar,
    PageHeader,
    RatingSummary,
    ReviewCard,
  ],
  templateUrl: './delivery-reviews.html',
  styleUrl: './delivery-reviews.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeliveryReviews {
  private readonly reviews = inject(ReviewService);
  private readonly dialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);

  protected readonly sortOptions = SORT_OPTIONS;
  protected readonly filterSections = [
    RATING_SECTION,
    optionsSection('comment', 'Comment', { with: 'With a comment', without: 'Rating only' }),
    datesSection('created', 'Rated'),
  ];
  protected readonly ratingList = filteredList((query) => this.reviews.riderReviews(query), {
    errorText: 'Could not load your ratings.',
    sort: 'newest',
    limit: 10,
  });
  protected readonly list = this.ratingList.list;

  /** The one star rating picked in the panel (the summary highlights it), else none. */
  protected readonly rating = computed(
    () => Number(onlyValue(this.ratingList.panel(), 'rating')) || null,
  );

  /** A bar of the rating summary: just that star rating, or none again. */
  protected pickRating(stars: number | null): void {
    this.ratingList.panel.update((v) => ({ ...v, rating: stars ? [String(stars)] : [] }));
  }

  protected report(review: RiderReview): void {
    reportReview(this.dialog, review.id).subscribe(() => {
      this.notify.success('Reported. The BiteBox team will review it.');
      this.list.reload();
    });
  }
}
