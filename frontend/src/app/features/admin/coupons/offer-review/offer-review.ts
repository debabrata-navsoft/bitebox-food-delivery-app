import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent, IconComponent, PaginationComponent } from 'nexprime';
import { AdminCouponService } from '../../../../core/services/checkout-api.service';
import { confirmed } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { conditionsLabel, discountLabel, scopeLabel } from '../../../../shared/coupons/coupon-labels';
import { rowActions } from '../../../../shared/coupons/coupon-list';
import { BbDialog } from '../../../../shared/dialog/bb-dialog';
import { pagedList } from '../../../../shared/list/paged-list';
import { TableLabels } from '../../../../shared/directives/table-labels';
import { AdminCoupon } from '../../../../core/models/checkout.models';

/** The approval queue: offers restaurants submitted, approved or rejected with a reason. */
@Component({
  selector: 'bb-offer-review',
  imports: [DatePipe, RouterLink, ButtonComponent, IconComponent, PaginationComponent, EmptyState, PageHeader, TableLabels],
  templateUrl: './offer-review.html',
  styleUrl: './offer-review.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfferReview {
  private readonly service = inject(AdminCouponService);
  private readonly bbDialog = inject(BbDialog);
  protected readonly discountLabel = discountLabel;
  protected readonly scopeLabel = scopeLabel;
  protected readonly conditionsLabel = conditionsLabel;

  protected readonly list = pagedList((page, limit) => this.service.pending({ page, limit }), {
    errorText: 'Could not load offers waiting for review.',
  });

  private readonly actions = rowActions(() => this.list.reload());
  protected readonly busy = this.actions.busy;

  protected approve(o: AdminCoupon): void {
    this.actions.run(o.id, this.service.approve(o.id), `${this.title(o)} approved. It now applies automatically.`);
  }

  protected reject(o: AdminCoupon): void {
    confirmed(this.bbDialog, {
      title: `Reject ${this.title(o)}?`,
      message: 'The restaurant sees your reason and can edit the offer and send it again.',
      confirmLabel: 'Reject',
      danger: true,
      reasonLabel: 'Reason',
      reasonMax: 300,
    }).subscribe((reason) => this.actions.run(o.id, this.service.reject(o.id, String(reason)), `${this.title(o)} rejected`));
  }

  /** Offers apply automatically, so admins know them by name rather than their internal code. */
  protected title(o: AdminCoupon): string {
    return o.name || o.description || discountLabel(o);
  }
}
