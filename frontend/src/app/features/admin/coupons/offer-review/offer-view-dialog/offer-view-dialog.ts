import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonComponent, IconComponent } from 'nexprime';
import { AdminCoupon } from '../../../../../core/models/checkout.models';
import { InfoRow, InfoRows } from '../../../../../shared/components/info-rows/info-rows';
import {
  conditionsLabel,
  discountLabel,
  offerTitle,
  scopeLabel,
  usesLabel,
} from '../../../../../shared/coupons/coupon-labels';
import {
  BB_DIALOG_DATA,
  BbDialog,
  BbDialogRef,
  BbDialogTitle,
} from '../../../../../shared/dialog/bb-dialog';
import { dateText } from '../../../../../shared/utils/dates';
import { DATE_YEAR_TIME } from '../../../../../shared/components/data-table/data-table';

export type OfferDecision = 'approve' | 'reject';

/** A restaurant offer waiting for review, in full (with its terms); Approve or Reject from here. */
@Component({
  selector: 'bb-offer-view-dialog',
  imports: [BbDialogTitle, ButtonComponent, IconComponent, InfoRows],
  templateUrl: './offer-view-dialog.html',
  styleUrl: './offer-view-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfferViewDialog {
  protected readonly offer = inject<AdminCoupon>(BB_DIALOG_DATA);
  protected readonly ref = inject<BbDialogRef<OfferDecision>>(BbDialogRef);
  private readonly dates = dateText();

  protected readonly title = offerTitle(this.offer);
  protected readonly discount = discountLabel(this.offer);
  protected readonly conditions = conditionsLabel(this.offer);

  protected readonly rows: InfoRow[] = [
    { icon: 'store', label: 'Applies to', value: scopeLabel(this.offer) },
    {
      icon: 'calendar',
      label: 'Valid',
      value: this.dates.range(this.offer.validFrom, this.offer.validUntil),
    },
    {
      icon: 'users',
      label: 'Uses',
      value: usesLabel(this.offer),
    },
    {
      icon: 'clock',
      label: 'Sent',
      value: this.dates.day(this.offer.updatedAt ?? this.offer.createdAt, DATE_YEAR_TIME),
    },
  ];

  /** The terms as points: one per line, or split at "1. … 2. …" when typed on one line. */
  protected readonly terms = (this.offer.terms ?? '')
    .split(/\n+|\s(?=\d+\.\s)/)
    .map((t) => t.replace(/^\s*\d+\.\s*/, '').trim())
    .filter(Boolean);
}

/** Opens an offer; emits the admin's decision if they chose one. */
export const openOfferView = (dialog: BbDialog, offer: AdminCoupon) =>
  dialog.result<OfferViewDialog, AdminCoupon, OfferDecision>(OfferViewDialog, {
    data: offer,
    width: '600px',
  });
