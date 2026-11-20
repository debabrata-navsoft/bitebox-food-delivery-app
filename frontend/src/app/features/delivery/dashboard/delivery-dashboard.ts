import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { IconComponent, ProgressBarComponent, ToggleComponent } from 'nexprime';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../../shared/utils/api-error';
import {
  GeolocationService,
  ImpreciseLocationError,
} from '../../../core/services/geolocation.service';
import { DeliveryLocationService } from '../../../core/services/delivery-location.service';
import { NotificationService } from '../../../core/services/notification.service';
import { RiderService } from '../../../core/services/order-management.service';
import { RiderGps } from '../../../core/services/rider-gps.service';
import { RiderSession } from '../../../core/services/rider-session.service';
import { Point } from '../../../core/services/routing.service';
import { TrackingMap } from '../../../shared/components/tracking-map/tracking-map';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { OrderStatusChip } from '../../../shared/components/order-status-chip/order-status-chip';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { StatTile } from '../../../shared/components/stat-tile/stat-tile';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { openLocationDetectedDialog } from '../location-dialog/location-detected-dialog';
import { openVehicleDialog } from '../vehicle-dialog/vehicle-dialog';
import { VEHICLE_LABEL } from '../../../core/models/checkout.models';
import {
  RiderStats,
  RIDER_VERIFICATION_COPY,
  riderReviewState,
} from '../../../core/models/order-management.models';
import { ItemCountPipe } from '../../../shared/pipes/item-count.pipe';
import { InrPipe, formatDistance } from '../../../shared/pipes/money.pipes';

@Component({
  selector: 'bb-delivery-dashboard',
  imports: [
    DecimalPipe,
    RouterLink,
    IconComponent,
    ProgressBarComponent,
    StatTile,
    ToggleComponent,
    EmptyState,
    OrderStatusChip,
    PageHeader,
    InrPipe,
    ItemCountPipe,
    TrackingMap,
  ],
  templateUrl: './delivery-dashboard.html',
  styleUrl: './delivery-dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeliveryDashboard {
  private readonly rider = inject(RiderService);
  private readonly geo = inject(GeolocationService);
  private readonly locationService = inject(DeliveryLocationService);
  private readonly notify = inject(NotificationService);
  protected readonly gps = inject(RiderGps);
  private readonly bbDialog = inject(BbDialog);
  private readonly router = inject(Router);
  private readonly session = inject(RiderSession);

  protected readonly data = this.session.data;
  protected readonly loadError = this.session.loadError;
  protected readonly acting = this.session.acting;
  protected readonly switching = signal(false);
  protected readonly availabilityError = signal<string | null>(null);
  protected readonly stats = signal<RiderStats | null>(null);
  /** When the API has no /delivery/stats: hide the figures. */
  protected readonly statsUnavailable = signal(false);
  protected readonly detectedPlace = this.session.detectedPlace;

  protected readonly profile = this.session.profile;
  protected readonly online = this.session.online;
  /** Shown until BiteBox has verified the rider (they cannot go online before). */
  protected readonly verification = computed(() => {
    const v = this.profile()?.verification;
    return v && v.status !== 'approved' ? v : null;
  });
  protected readonly verifyCopy = RIDER_VERIFICATION_COPY;
  protected readonly reviewState = riderReviewState;
  protected readonly onlineSwitch = linkedSignal(() => this.online());
  protected readonly offer = this.session.offer;
  protected readonly active = this.session.active;
  protected readonly vehicleLabel = VEHICLE_LABEL;

  private readonly statsOnDelivery = effect(() => {
    const completed = this.profile()?.completedDeliveries;
    if (completed === undefined) return;
    untracked(() => this.loadStats());
  });

  private loadStats(): void {
    if (this.statsUnavailable()) return;
    this.rider.stats().subscribe({
      next: (stats) => this.stats.set(stats),
      error: (err: unknown) => {
        // 404: the Node API (no figures endpoint). Other errors: keep the last figures.
        if (err instanceof HttpErrorResponse && err.status === 404) this.statsUnavailable.set(true);
      },
    });
  }

  protected readonly idlePosition = computed<Point | null>(() => {
    const fix = this.gps.fix();
    return fix ? { latitude: fix.latitude, longitude: fix.longitude } : null;
  });
  // The request's countdown and popup belong to the whole rider panel (RiderSession).
  protected readonly offerSecondsLeft = this.session.offerSecondsLeft;
  protected readonly offerProgress = this.session.offerProgress;
  protected readonly openOffer = () => this.session.openOffer();

  constructor() {
    // Once per online session: the place name and the "location detected" popup.
    effect(() => {
      const online = this.online();
      const fix = this.gps.fix();
      untracked(() => {
        if (!online) {
          this.session.locationShown = false;
        } else if (fix && !this.session.locationShown) {
          this.session.locationShown = true;
          this.locationService.reverse(fix.latitude, fix.longitude).subscribe({
            next: (p) => this.detectedPlace.set(p.area || p.city || p.label || null),
            error: () => undefined,
          });
          this.showLocationPopup(fix);
        }
      });
    });
  }

  /** "Change" or "Add": the vehicle dialog; the saved profile updates the dashboard. */
  protected editVehicle(): void {
    openVehicleDialog(this.bbDialog, this.profile()).subscribe((profile) =>
      this.data.update((d) => (d ? { ...d, profile } : d)),
    );
  }

  protected async setOnline(online: boolean): Promise<void> {
    this.onlineSwitch.set(online);
    this.switching.set(true);
    this.availabilityError.set(null);
    try {
      if (online) {
        const here = await this.geo.currentPrecise();
        this.session.apply(
          await firstValueFrom(this.rider.goOnline(here.latitude, here.longitude)),
        );
        this.notify.success('You are online. Requests near you will appear here.');
        this.session.locationShown = true;
        this.showLocationPopup(here);
      } else {
        this.session.locationShown = false;
        this.session.apply(await firstValueFrom(this.rider.goOffline()));
      }
    } catch (err) {
      this.availabilityError.set(
        err instanceof ImpreciseLocationError
          ? `This device only knows your location to within about ${formatDistance(err.accuracyMeters)}, ` +
              'which is too vague to offer you nearby orders. Turn on GPS / precise location, or use your phone.'
          : err instanceof Error // browser location errors carry a readable message
            ? err.message
            : errorMessage(err),
      );
      this.onlineSwitch.set(this.online());
      this.session.refresh();
    } finally {
      this.switching.set(false);
    }
  }

  private showLocationPopup(at: { latitude: number; longitude: number; accuracy?: number }): void {
    const { latitude, longitude, accuracy } = at;
    const area = this.detectedPlace() ?? undefined;
    openLocationDetectedDialog(this.bbDialog, { latitude, longitude, accuracy, area });
  }

  protected reopenLocationPopup(): void {
    const fix = this.gps.fix();
    if (fix) return this.showLocationPopup(fix);
    this.geo.currentPrecise().then(
      (here) => this.showLocationPopup(here),
      () => this.notify.error('Could not detect location. Please check your device GPS.'),
    );
  }
}
