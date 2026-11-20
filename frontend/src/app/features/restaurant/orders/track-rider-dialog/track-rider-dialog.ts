import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, Signal, computed, inject } from '@angular/core';
import { ButtonComponent, IconComponent } from 'nexprime';
import { RestaurantOrder } from '../../../../core/models/order-management.models';
import { distanceMeters } from '../../../../core/services/routing.service';
import { deliveryTracking } from '../../../../shared/components/tracking-map/delivery-tracking';
import { TrackingMap } from '../../../../shared/components/tracking-map/tracking-map';
import {
  BB_DIALOG_DATA,
  BbDialog,
  BbDialogRef,
  BbDialogTitle,
} from '../../../../shared/dialog/bb-dialog';

/** What the rider is doing, in the restaurant's words. */
const STAGE: Partial<Record<RestaurantOrder['status'], string>> = {
  assigned: 'is coming to collect the order',
  arrived_at_restaurant: 'is at your restaurant',
  picked_up: 'has the order and is heading to the customer',
  on_the_way: 'is on the way to the customer',
};

/**
 * The restaurant follows the rider carrying one of its orders: live position and trail on a map,
 * and whose order it is. The customer appears by name and area only (never the exact address).
 */
@Component({
  selector: 'bb-track-rider-dialog',
  imports: [DecimalPipe, BbDialogTitle, ButtonComponent, IconComponent, TrackingMap],
  templateUrl: './track-rider-dialog.html',
  styleUrl: './track-rider-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrackRiderDialog {
  /** The order as the board keeps it, so the stage updates while the dialog is open. */
  protected readonly order = inject<Signal<RestaurantOrder | null>>(BB_DIALOG_DATA);
  protected readonly ref = inject(BbDialogRef);
  protected readonly t = deliveryTracking(this.order);

  protected readonly stage = computed(() => STAGE[this.order()?.status ?? 'assigned'] ?? null);
  /** How far the rider is from the restaurant (straight line), while coming to collect. */
  protected readonly away = computed(() => {
    const rider = this.t.rider();
    const restaurant = this.t.restaurant();
    return this.order()?.status === 'assigned' && rider && restaurant
      ? distanceMeters(rider, restaurant)
      : null;
  });
}

export const openTrackRider = (dialog: BbDialog, order: Signal<RestaurantOrder | null>) =>
  dialog.open<TrackRiderDialog, Signal<RestaurantOrder | null>>(TrackRiderDialog, {
    data: order,
    width: '640px',
  });
