import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from 'nexprime';
import { AdminReviewCounts } from '../../../core/services/admin/admin-review-counts.service';

interface Shortcut {
  icon: string;
  title: string;
  detail: string;
  link: string;
  query: Record<string, string>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Shortcuts to what is waiting for an admin's decision: restaurant applications and delivery
 * partners' documents. Shown on the admin and operations dashboards, only while something is
 * waiting (counts from AdminReviewCounts, which the admin layout keeps fresh).
 */
@Component({
  selector: 'bb-review-shortcuts',
  imports: [RouterLink, IconComponent],
  templateUrl: './review-shortcuts.html',
  styleUrl: './review-shortcuts.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewShortcuts {
  private readonly counts = inject(AdminReviewCounts);

  protected readonly shortcuts = computed<Shortcut[]>(() => {
    const list: Shortcut[] = [];
    const rc = this.counts.restaurants();
    if (rc?.pending) {
      list.push({
        icon: 'store',
        title: `${plural(rc.pending, 'restaurant application', 'restaurant applications')} awaiting review`,
        detail: `${rc.approved} live · ${rc.suspended} suspended · ${rc.rejected} rejected`,
        link: '/admin/restaurants',
        query: { status: 'pending' },
      });
    }
    const riders = this.counts.pendingRiders();
    if (riders) {
      list.push({
        icon: 'bike',
        title: `${plural(riders, 'delivery partner', 'delivery partners')} awaiting verification`,
        detail: 'Documents uploaded, waiting for a decision',
        link: '/admin/delivery-partners',
        query: { verification: 'pending' },
      });
    }
    return list;
  });
}
