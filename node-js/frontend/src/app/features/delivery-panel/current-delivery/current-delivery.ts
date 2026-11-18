import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ButtonComponent, IconComponent } from 'nexprime';
import { NotificationService } from '../../../core/services/notification.service';
import { MAX_USABLE_ACCURACY_M } from '../../../core/services/geolocation.service';
import { DESKTOP_UP, mediaQuery } from '../../../core/services/media-query';
import { RiderService } from '../../../core/services/order-management.service';
import { RiderGps } from '../../../core/services/rider-gps.service';
import { RiderSession } from '../../../core/services/rider-session.service';
import { Point, etaMinutes, fromCoordinates } from '../../../core/services/routing.service';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { OrderStatusChip } from '../../../shared/components/order-status-chip/order-status-chip';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { rerouteWhileMoving } from '../../../shared/components/tracking-map/delivery-tracking';
import { TrackingMap } from '../../../shared/components/tracking-map/tracking-map';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { NpIconPipe } from '../../../shared/icons/np-icon-name';
import {
  AT_OR_TO_RESTAURANT,
  RiderAction,
  RiderOrder,
} from '../../../shared/models/order-management.models';
import { ItemCountPipe } from '../../../shared/pipes/item-count.pipe';
import { InrPipe } from '../../../shared/pipes/money.pipes';
import { openDeliveryCode } from '../delivery-code-dialog/delivery-code-dialog';

const DELIVERED = 'Delivered. Nice work!';

/** What each move looks like in the app. */
const STEP: Record<RiderAction, { label: string; hint: string; icon: string }> = {
  arrived_at_restaurant: {
    label: 'Arrived at restaurant',
    hint: 'Go to the restaurant. Tap when you are there so they hand you the order.',
    icon: 'store',
  },
  picked_up: {
    label: 'Picked up',
    hint: 'Go to the restaurant and collect the order.',
    icon: 'inventory_2',
  },
  on_the_way: {
    label: 'Start delivery',
    hint: 'Order collected. Head to the customer.',
    icon: 'two_wheeler',
  },
  delivered: { label: 'Delivered', hint: '', icon: 'task_alt' },
};

/** The next move when the API does not list them (the Node API has no arrival step). */
const NEXT_ACTION: Partial<Record<RiderOrder['status'], RiderAction>> = {
  assigned: 'picked_up',
  picked_up: 'on_the_way',
  on_the_way: 'delivered',
};

/**
 * The delivery the rider is carrying: both stops, the map and route, cash to collect and the next
 * step. Once delivered it goes back to the dashboard.
 */
@Component({
  selector: 'bb-current-delivery',
  imports: [
    DecimalPipe,
    NgTemplateOutlet,
    RouterLink,
    ButtonComponent,
    IconComponent,
    NpIconPipe,
    EmptyState,
    OrderStatusChip,
    PageHeader,
    TrackingMap,
    InrPipe,
    ItemCountPipe,
  ],
  templateUrl: './current-delivery.html',
  styleUrl: './current-delivery.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CurrentDelivery {
  private readonly rider = inject(RiderService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly bbDialog = inject(BbDialog);
  private readonly gps = inject(RiderGps);
  private readonly session = inject(RiderSession);

  protected readonly data = this.session.data;
  protected readonly loadError = this.session.loadError;
  protected readonly acting = this.session.acting;
  protected readonly active = this.session.active;
  /** Desktop: the map gets its own card beside the details. */
  protected readonly isDesktop = mediaQuery(DESKTOP_UP);
  protected readonly nextStep = computed(() => {
    const o = this.active();
    const action = o && (o.nextStatuses ? o.nextStatuses[0] : NEXT_ACTION[o.status]);
    if (!o || !action) return null;
    const step = { action, ...STEP[action] };
    if (o.status === 'arrived_at_restaurant') {
      step.hint = 'Collect the order from the counter, then tap Picked up.';
    } else if (action === 'delivered') {
      const paid = o.paymentMethod === 'online' || o.paymentStatus === 'paid';
      const code = o.deliveryOtpRequired ? " and ask for the customer's 4-digit code" : '';
      step.hint = paid
        ? `Hand over the order${code} (already paid online).`
        : `Hand over the order, collect the cash${code}.`;
    }
    return step;
  });

  protected readonly stops = computed(() => {
    const o = this.active();
    if (!o) return null;
    const restaurant = fromCoordinates(o.restaurantSnapshot.location?.coordinates);
    const destination = fromCoordinates(o.deliveryAddress.location?.coordinates);
    const toRestaurant = AT_OR_TO_RESTAURANT.includes(o.status);
    return {
      restaurant,
      destination,
      target: toRestaurant ? restaurant : destination,
      toRestaurant,
    };
  });
  protected readonly directionsUrl = computed(() => {
    const t = this.stops()?.target;
    return t
      ? `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=;${t.latitude},${t.longitude}`
      : null;
  });
  protected readonly myPosition = computed<Point | null>(() => {
    const fix = this.gps.fix();
    return fix && fix.accuracy <= MAX_USABLE_ACCURACY_M
      ? { latitude: fix.latitude, longitude: fix.longitude }
      : null;
  });
  protected readonly routeToStop = rerouteWhileMoving(
    this.myPosition,
    computed(() => this.stops()?.target ?? null),
  );
  protected readonly minutes = etaMinutes;

  protected advance(order: RiderOrder): void {
    const step = this.nextStep();
    if (!step) return;
    const delivered = step.action === 'delivered';
    if (delivered && order.deliveryOtpRequired) {
      // The dialog sends the code itself, so a wrong code is shown there and can be retried.
      openDeliveryCode(this.bbDialog, order).subscribe((d) => {
        this.session.apply(d);
        this.notify.success(DELIVERED);
        this.backToDashboard();
      });
      return;
    }
    this.session.run(
      this.rider.setStatus(order.id, step.action),
      delivered ? DELIVERED : step.label,
      delivered ? () => this.backToDashboard() : undefined,
    );
  }

  /** Delivered: back to the dashboard for the next request. */
  private backToDashboard(): void {
    void this.router.navigateByUrl('/delivery');
  }
}
