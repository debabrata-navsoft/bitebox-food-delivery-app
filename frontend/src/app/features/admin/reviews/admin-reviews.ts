import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginatorModule } from '@angular/material/paginator';
import { IconComponent, TabsComponent } from 'nexprime';
import { ReviewService } from '../../../core/services/review.service';
import { ListEmpty } from '../../../shared/components/list-empty/list-empty';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { ReviewOrderRow } from '../../../shared/components/review-order-row/review-order-row';
import { datesSection, filteredList, optionsSection } from '../../../shared/list/filtered-list';
import {
  AdminOrderReviewPage,
  AdminOrderReviews,
  RATING_SECTION,
  STATUS_LABEL,
  TARGET_PLURAL,
} from '../../../shared/models/review.models';
import { openAdminOrderReviews } from './order-dialog/admin-order-reviews-dialog';
import { ReviewAnalyticsPanel } from './review-analytics/review-analytics';

const TABS = ['all', 'reported', 'analytics'] as const;

/** Reviews one row per order (reported orders first in the queue), and rating analytics. */
@Component({
  selector: 'bb-admin-reviews',
  imports: [
    ListToolbar,
    MatButtonModule,
    MatPaginatorModule,
    TabsComponent,
    IconComponent,
    ListEmpty,
    PageHeader,
    ReviewOrderRow,
    ReviewAnalyticsPanel,
  ],
  templateUrl: './admin-reviews.html',
  styleUrl: './admin-reviews.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminReviews {
  private readonly reviews = inject(ReviewService);
  private readonly dialog = inject(MatDialog);

  protected readonly activeTab = signal(0);
  protected readonly tab = computed(() => TABS[this.activeTab()]);

  /** The reported tab is the moderation queue, open whatever the status, so it has no status filter. */
  protected readonly filterSections = computed(() => [
    optionsSection('target', 'About', TARGET_PLURAL),
    ...(this.tab() === 'all' ? [optionsSection('status', 'Status', STATUS_LABEL)] : []),
    RATING_SECTION,
    optionsSection('restaurant', 'Restaurant'), // from the API's counts
    datesSection('created', 'Written'),
  ]);

  protected readonly reviewList = filteredList(
    ({ status, ...query }) =>
      this.reviews.adminOrders({ ...query, ...(this.tab() === 'all' && { status }) }),
    {
      errorText: 'Could not load reviews.',
      extra: () => ({ reported: this.tab() === 'reported' ? 'true' : undefined }),
      pollMs: 60_000,
      when: () => false, // order events don't change reviews; just the slow poll
    },
  );
  protected readonly list = this.reviewList.list;

  /** Tab badge; keeps the last count while the list is cleared for a tab switch. */
  protected readonly reportedCount = linkedSignal<AdminOrderReviewPage | null, number | undefined>({
    source: this.list.data,
    computation: (page, previous) => (page ? page.counts?.reported : previous?.value),
  });

  /** All reviews first, then the moderation queue (with its count), then analytics. */
  protected readonly tabItems = computed(() => [
    { id: 'all', label: 'All reviews', content: '' },
    { id: 'reported', label: 'Reported', content: '', badge: this.reportedCount() || undefined },
    { id: 'analytics', label: 'Analytics', content: '' },
  ]);

  protected selectTabId(id: string): void {
    const index = TABS.indexOf(id as (typeof TABS)[number]);
    if (index >= 0) this.selectTab(index);
  }

  protected selectTab(index: number): void {
    if (index === this.activeTab()) return;
    this.list.clear(); // the other tab's rows would otherwise show, dimmed, until the new list loads
    this.activeTab.set(index);
  }

  protected open(row: AdminOrderReviews): void {
    openAdminOrderReviews(this.dialog, row.order).subscribe(() => this.list.reload());
  }

  protected statusNote(row: AdminOrderReviews): string | null {
    const off = row.reviews.filter((r) => r.status !== 'published');
    if (!off.length) return null;
    return off.length === 1 ? `1 ${STATUS_LABEL[off[0].status].toLowerCase()}` : `${off.length} not public`;
  }
}
