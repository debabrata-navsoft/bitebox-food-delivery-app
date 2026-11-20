import {
  ChangeDetectionStrategy,
  Component,
  Signal,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ButtonComponent, IconComponent, ProgressBarComponent } from 'nexprime';
import {
  BB_DIALOG_DATA,
  BbDialog,
  BbDialogRef,
  BbDialogTitle,
} from '../../../shared/dialog/bb-dialog';
import { RiderGps } from '../../../core/services/rider-gps.service';
import {
  RoadRoute,
  distanceMeters,
  etaMinutes,
  fromCoordinates,
} from '../../../core/services/routing.service';
import { rerouteWhileMoving } from '../../../shared/components/tracking-map/delivery-tracking';
import { TrackingMap } from '../../../shared/components/tracking-map/tracking-map';
import { RiderOrder, collectsCash } from '../../../core/models/order-management.models';
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

interface Leg {
  label: string;
  icon: string;
  /** Null when the distance is unknown (no GPS fix yet). */
  meters: number | null;
  /** Road minutes; null for a straight-line distance. */
  minutes: number | null;
}

/** A leg by road when the routing service answered, otherwise as the crow flies. */
const leg = (label: string, icon: string, road: RoadRoute | null, straight: number | null): Leg =>
  road
    ? { label, icon, meters: road.distanceMeters, minutes: etaMinutes(road.durationSeconds) }
    : { label, icon, meters: straight, minutes: null };

/** "0.8 km", or "under 0.1 km" for a very short leg. */
const km = (meters: number) => (meters < 100 ? 'under 0.1 km' : `${(meters / 1000).toFixed(1)} km`);

/**
 * A new delivery request, shown as a popup the moment it arrives. It closes with the rider's
 * decision (the dashboard sends it), when the dashboard sees the request go, or once it runs out.
 */
@Component({
  selector: 'bb-offer-dialog',
  imports: [
    BbDialogTitle,
    ButtonComponent,
    IconComponent,
    ProgressBarComponent,
    TrackingMap,
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
  protected readonly cod = collectsCash(this.order);
  protected readonly progress = computed(() => offerProgress(this.secondsLeft(), this.order));
  protected readonly km = km;

  // The trip on a map: the rider (live GPS), the restaurant and the customer's area, with road
  // estimates for both legs (straight lines until the routing service answers).
  private readonly gps = inject(RiderGps);
  protected readonly restaurant = fromCoordinates(
    this.order.restaurantSnapshot.location?.coordinates,
  );
  protected readonly destination = fromCoordinates(
    this.order.deliveryAddress.location?.coordinates,
  );
  protected readonly me = this.gps.position;
  private readonly toPickup = rerouteWhileMoving(this.me, signal(this.restaurant));
  private readonly toCustomer = rerouteWhileMoving(
    signal(this.restaurant),
    signal(this.destination),
  );
  /** Both road legs as one line (the map falls back to a dashed straight line without them). */
  protected readonly path = computed(() => {
    const trip = this.toCustomer()?.path;
    return trip ? [...(this.toPickup()?.path ?? []), ...trip] : null;
  });
  /** Both legs, then the whole trip once both distances are known. */
  protected readonly legs = computed<Leg[]>(() => {
    const me = this.me();
    const straightToPickup =
      me && this.restaurant
        ? distanceMeters(me, this.restaurant)
        : (this.order.pickupDistanceMeters ?? null);
    const [a, b] = [
      leg('You to the restaurant', 'bike', this.toPickup(), straightToPickup),
      leg('Restaurant to customer', 'house', this.toCustomer(), this.order.distanceMeters),
    ];
    if (a.meters === null || b.meters === null) return [a, b];
    const minutes = a.minutes !== null && b.minutes !== null ? a.minutes + b.minutes : null;
    return [a, b, { label: 'Total trip', icon: 'route', meters: a.meters + b.meters, minutes }];
  });

  constructor() {
    effect(() => this.secondsLeft() === 0 && this.ref.close());
  }
}

export const openOfferDialog = (dialog: BbDialog, data: OfferDialogData) =>
  dialog.open<OfferDialog, OfferDialogData, OfferDecision>(OfferDialog, { data, width: '520px' });
