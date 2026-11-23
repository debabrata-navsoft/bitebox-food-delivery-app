import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent, IconComponent } from 'nexprime';
import { AdminCouponService } from '../../../../core/services/checkout-api.service';
import { confirmed } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import {
  BbCell,
  BbEmpty,
  DATE_TIME,
  DataTable,
  TableColumn,
} from '../../../../shared/components/data-table/data-table';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { couponColumns, offerTitle, scopeLabel } from '../../../../shared/coupons/coupon-labels';
import { rowActions } from '../../../../shared/coupons/coupon-list';
import { BbDialog } from '../../../../shared/dialog/bb-dialog';
import { pagedList } from '../../../../shared/list/paged-list';
import { AdminCoupon } from '../../../../core/models/checkout.models';
import { dateText } from '../../../../shared/utils/dates';

/** The approval queue: offers restaurants submitted, approved or rejected with a reason. */
@Component({
  selector: 'bb-offer-review',
  imports: [
    RouterLink,
    ButtonComponent,
    IconComponent,
    EmptyState,
    PageHeader,
    DataTable,
    BbCell,
    BbEmpty,
  ],
  templateUrl: './offer-review.html',
  styleUrl: './offer-review.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfferReview {
  private readonly service = inject(AdminCouponService);
  private readonly bbDialog = inject(BbDialog);

  protected readonly list = pagedList((page, limit) => this.service.pending({ page, limit }), {
    errorText: 'Could not load offers waiting for review.',
  });

  private readonly runner = rowActions(() => this.list.reload());
  protected readonly busy = this.runner.busy;

  private readonly shared = couponColumns(dateText().range);
  protected readonly columns: TableColumn<AdminCoupon>[] = [
    {
      label: 'Offer',
      // Offers apply automatically, so admins know them by name rather than their internal code.
      value: offerTitle,
      strong: true,
      sub: (o) => [o.name && o.description, o.terms],
    },
    { label: 'Applies to', value: scopeLabel },
    this.shared.discount,
    {
      ...this.shared.valid(),
      sub: (o) =>
        `${o.usageLimit ? o.usageLimit + ' uses' : 'Unlimited uses'} · ${o.perUserLimit} per customer`,
    },
    { label: 'Sent', date: (o) => o.updatedAt ?? o.createdAt, dateFormat: DATE_TIME },
    { label: 'Decision', key: 'decide', class: 'actions', hideLabel: true },
  ];

  protected approve(o: AdminCoupon): void {
    this.runner.run(o.id, this.service.approve(o.id), `${offerTitle(o)} approved. It now applies automatically.`);
  }

  protected reject(o: AdminCoupon): void {
    confirmed(this.bbDialog, {
      title: `Reject ${offerTitle(o)}?`,
      message: 'The restaurant sees your reason and can edit the offer and send it again.',
      confirmLabel: 'Reject',
      danger: true,
      reasonLabel: 'Reason',
      reasonMax: 300,
    }).subscribe((reason) => this.runner.run(o.id, this.service.reject(o.id, String(reason)), `${offerTitle(o)} rejected`));
  }}
