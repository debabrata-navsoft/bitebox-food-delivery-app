import {
  ChangeDetectionStrategy,
  Component,
  Signal,
  computed,
  effect,
  inject,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ButtonComponent, IconComponent, ProgressBarComponent } from 'nexprime';
import {
  BB_DIALOG_DATA,
  BbDialog,
  BbDialogRef,
  BbDialogTitle,
} from '../../../shared/dialog/bb-dialog';
import { RiderOrder } from '../../../shared/models/order-management.models';
import { ItemCountPipe } from '../../../shared/pipes/item-count.pipe';
import { InrPipe } from '../../../shared/pipes/money.pipes';

export type OfferDecision = 'accept' | 'decline';

export interface OfferDialogData {
  order: RiderOrder;
  /** Live countdown from the dashboard, so it keeps ticking while the popup is open. */
  secondsLeft: Signal<number>;
}

/** Share of the response window left, for the progress bar. */
export const offerProgress = (secondsLeft: number, order: RiderOrder | null): number =>
  (secondsLeft / (order?.offerWindowSeconds ?? 90)) * 100;

/**
 * A new delivery request, shown as a popup the moment it arrives. It closes with the rider's
 * decision (the dashboard sends it), when the dashboard sees the request go, or once it runs out.
 */
@Component({
  selector: 'bb-offer-dialog',
  imports: [
    DecimalPipe,
    BbDialogTitle,
    ButtonComponent,
    IconComponent,
    ProgressBarComponent,
    InrPipe,
    ItemCountPipe,
  ],
  templateUrl: './offer-dialog.html',
  styleUrl: './offer-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfferDialog {
  private readonly data = inject<OfferDialogData>(BB_DIALOG_DATA);
  protected readonly ref = inject<BbDialogRef<OfferDecision>>(BbDialogRef);
  protected readonly order = this.data.order;
  protected readonly secondsLeft = this.data.secondsLeft;
  protected readonly progress = computed(() => offerProgress(this.secondsLeft(), this.order));
  private readonly expired = computed(() => this.secondsLeft() === 0);

  constructor() {
    effect(() => this.expired() && this.ref.close());
  }
}

export const openOfferDialog = (dialog: BbDialog, data: OfferDialogData) =>
  dialog.open<OfferDialog, OfferDialogData, OfferDecision>(OfferDialog, { data, width: '480px' });
