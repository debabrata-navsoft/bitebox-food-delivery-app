import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonComponent, IconComponent } from 'nexprime';
import { PaymentOfferOption } from '../../../../core/models/checkout.models';
import {
  BB_DIALOG_DATA,
  BbDialog,
  BbDialogRef,
  BbDialogTitle,
} from '../../../../shared/dialog/bb-dialog';
import { InrPipe } from '../../../../shared/pipes/money.pipes';
import { PayWith, PaymentOption } from '../../../../shared/utils/payment-options';

export interface PaymentDialogData {
  options: PaymentOption[];
  /** The best payment offer per online channel (the server's figures). */
  offers: Map<PayWith, PaymentOfferOption>;
  totalPaise: number;
}

/** "Place order": the customer picks how to pay; the dialog closes with that choice. */
@Component({
  selector: 'bb-payment-dialog',
  imports: [BbDialogTitle, ButtonComponent, IconComponent, InrPipe],
  templateUrl: './payment-dialog.html',
  styleUrl: './payment-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentDialog {
  protected readonly data = inject<PaymentDialogData>(BB_DIALOG_DATA);
  protected readonly ref = inject<BbDialogRef<PayWith>>(BbDialogRef);
}

export const choosePayment = (dialog: BbDialog, data: PaymentDialogData) =>
  dialog.result<PaymentDialog, PaymentDialogData, PayWith>(PaymentDialog, {
    data,
    width: '680px',
    disableClose: true, // only Cancel (or picking a method) closes it
  });
