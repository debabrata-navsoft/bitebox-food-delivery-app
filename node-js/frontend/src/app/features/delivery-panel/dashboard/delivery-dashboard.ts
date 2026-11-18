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
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { IconComponent, ProgressBarComponent, ToggleComponent } from 'nexprime';
import { EMPTY, firstValueFrom, interval, switchMap } from 'rxjs';
import { errorMessage } from '../../../core/services/api-error';
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
import { BbDialog, BbDialogRef } from '../../../shared/dialog/bb-dialog';
import { openLocationDetectedDialog } from '../location-dialog/location-detected-dialog';
import {
  OfferDecision,
  OfferDialog,
  offerProgress,
  openOfferDialog,
} from '../offer-dialog/offer-dialog';
import { openVehicleDialog } from '../vehicle-dialog/vehicle-dialog';
import { VEHICLE_LABEL } from '../../../shared/models/checkout.models';
import {
  RiderOrder,
  RiderStats,
  RIDER_VERIFICATION_COPY,
  riderReviewState,
} from '../../../shared/models/order-management.models';
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
  private offerDialog: BbDialogRef<OfferDecision, OfferDialog> | null = null;

  protected readonly data = this.session.data;
  protected readonly loadError = this.session.loadError;
  protected readonly acting = this.session.acting;
  protected readonly switching = signal(false);
  protected readonly availabilityError = signal<string | null>(null);
  protected readonly now = signal(Date.now());
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
  protected readonly offerSecondsLeft = computed(() => {
    const expires = this.offer()?.offerExpiresAt;
    return expires ? Math.max(0, Math.ceil((new Date(expires).getTime() - this.now()) / 1000)) : 0;
  });
  protected readonly offerProgress = computed(() =>
    offerProgress(this.offerSecondsLeft(), this.offer()),
  );

  constructor() {
    toObservable(computed(() => this.offer() !== null))
      .pipe(
        switchMap((offered) => (offered ? interval(1000) : EMPTY)),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.now.set(Date.now()));

    // A new request: announce it and show it as a popup; close the popup once it is gone.
    let shownOffer: string | undefined;
    effect(() => {
      const offer = this.offer();
      untracked(() => {
        if (offer?.id === shownOffer) return;
        shownOffer = offer?.id;
        this.offerDialog?.close();
        if (!offer) return;
        this.now.set(Date.now());
        this.notify.info(`New delivery request from ${offer.restaurantSnapshot.name}`);
        this.openOffer();
      });
    });

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
          this.showLocationPopup(fix.latitude, fix.longitude, fix.accuracy);
        }
      });
    });
  }

  /** The request as a popup; it closes itself once the request has run out. */
  protected openOffer(): void {
    const order = this.offer();
    if (this.offerDialog || !order) return;
    this.offerDialog = openOfferDialog(this.bbDialog, {
      order,
      secondsLeft: this.offerSecondsLeft,
    });
    this.offerDialog.closed.subscribe((decision) => {
      this.offerDialog = null;
      if (decision === 'accept') this.accept(order);
      else if (decision === 'decline') this.decline(order);
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
        const { latitude, longitude, accuracy } = await this.geo.currentPrecise();
        this.session.apply(await firstValueFrom(this.rider.goOnline(latitude, longitude)));
        this.notify.success('You are online. Requests near you will appear here.');
        this.session.locationShown = true;
        this.showLocationPopup(latitude, longitude, accuracy);
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

  protected showLocationPopup(latitude: number, longitude: number, accuracy?: number): void {
    openLocationDetectedDialog(this.bbDialog, {
      latitude,
      longitude,
      accuracy,
      area: this.detectedPlace() ?? undefined,
    });
  }

  protected reopenLocationPopup(): void {
    const fix = this.gps.fix();
    if (fix) {
      this.showLocationPopup(fix.latitude, fix.longitude, fix.accuracy);
      return;
    }
    this.geo.currentPrecise().then(
      (c) => this.showLocationPopup(c.latitude, c.longitude, c.accuracy),
      () => this.notify.error('Could not detect location. Please check your device GPS.'),
    );
  }

  protected accept(order: RiderOrder): void {
    this.session.run(
      this.rider.accept(order.id),
      'Accepted. Head to the restaurant.',
      () => void this.router.navigateByUrl('/delivery/current'),
    );
  }

  protected decline(order: RiderOrder): void {
    this.session.run(this.rider.decline(order.id), 'Request declined');
  }
}
