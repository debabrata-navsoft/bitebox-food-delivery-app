import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent, IconComponent } from 'nexprime';
import { catchError, of } from 'rxjs';
import { RestaurantOrder } from '../../../../core/models/order-management.models';
import { MyRestaurantService } from '../../../../core/services/my-restaurant.service';
import { pollWhileVisible } from '../../../../core/services/poll';
import { TrackingMap } from '../../../../shared/components/tracking-map/tracking-map';
import {
  BB_DIALOG_DATA,
  BbDialog,
  BbDialogRef,
  BbDialogTitle,
} from '../../../../shared/dialog/bb-dialog';

const REFRESH_MS = 15_000;

/**
 * While an order waits for a rider: the free delivery partners within the search distance, on a
 * map with that distance as a circle. Positions are rounded (other people's live locations), and
 * the customer is shown only by area (restaurants never get the exact address).
 */
@Component({
  selector: 'bb-nearby-riders-dialog',
  imports: [BbDialogTitle, ButtonComponent, IconComponent, TrackingMap],
  templateUrl: './nearby-riders-dialog.html',
  styleUrl: './nearby-riders-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NearbyRidersDialog {
  protected readonly order = inject<RestaurantOrder>(BB_DIALOG_DATA);
  protected readonly ref = inject(BbDialogRef);
  private readonly api = inject(MyRestaurantService);

  /** `undefined` while loading, `null` when it could not be loaded. */
  protected readonly data = toSignal(
    pollWhileVisible(() => this.api.nearbyRiders().pipe(catchError(() => of(null))), REFRESH_MS),
  );
  protected readonly riders = computed(() => this.data()?.riders ?? []);
  protected readonly nearest = computed(() => this.riders()[0]?.distanceMeters ?? null);
}

export const openNearbyRiders = (dialog: BbDialog, order: RestaurantOrder) =>
  dialog.open<NearbyRidersDialog, RestaurantOrder>(NearbyRidersDialog, {
    data: order,
    width: '640px',
  });
