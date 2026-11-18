import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ButtonComponent, IconComponent } from 'nexprime';
import {
  BB_DIALOG_DATA,
  BbDialog,
  BbDialogRef,
  BbDialogTitle,
} from '../../../../shared/dialog/bb-dialog';
import { RestaurantOrder } from '../../../../shared/models/order-management.models';
import { ItemCountPipe } from '../../../../shared/pipes/item-count.pipe';
import { InrPipe } from '../../../../shared/pipes/money.pipes';

const CHOICES = [10, 15, 20, 25, 30, 45, 60, 90];

/** Accept an order with a preparation time (master prompt §3B); closes with the minutes. */
@Component({
  selector: 'bb-accept-dialog',
  imports: [DatePipe, BbDialogTitle, ButtonComponent, IconComponent, InrPipe, ItemCountPipe],
  templateUrl: './accept-dialog.html',
  styleUrl: './accept-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcceptDialog {
  protected readonly order = inject<RestaurantOrder>(BB_DIALOG_DATA);
  protected readonly ref = inject<BbDialogRef<number>>(BbDialogRef);
  protected readonly choices = CHOICES;
  protected readonly minutes = signal(20);
  /** When the food should be ready if accepted now. */
  protected readonly readyAt = computed(() => Date.now() + this.minutes() * 60_000);
}

export const askPrepTime = (dialog: BbDialog, order: RestaurantOrder) =>
  dialog.result<AcceptDialog, RestaurantOrder, number>(AcceptDialog, {
    data: order,
    width: '460px',
  });
