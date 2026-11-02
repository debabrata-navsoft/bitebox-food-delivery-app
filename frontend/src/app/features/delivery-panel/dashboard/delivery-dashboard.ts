import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { FormRoot, form, required } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { SelectOption, ToggleComponent } from 'nexprime';
import { catchError, firstValueFrom, interval, of } from 'rxjs';
import { errorMessage } from '../../../core/services/api-error';
import { GeolocationService, ImpreciseLocationError } from '../../../core/services/geolocation.service';
import { NotificationService } from '../../../core/services/notification.service';
import { RiderService } from '../../../core/services/order-management.service';
import { pollWhileVisible } from '../../../core/services/poll';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { OrderStatusChip } from '../../../shared/components/order-status-chip/order-status-chip';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { shownError } from '../../../shared/forms/form-errors';
import { NP_FORM_FIELDS } from '../../../shared/forms/np-form-fields';
import { VEHICLE_LABEL, VehicleType } from '../../../shared/models/checkout.models';
import { RiderAction, RiderDashboard, RiderOrder } from '../../../shared/models/order-management.models';
import { InrPipe } from '../../../shared/pipes/money.pipes';

const POLL_MS = 10_000;
const LOCATION_EVERY_MS = 60_000;

/** The next step on an active delivery, and what the rider should do before pressing it. */
const NEXT_STEP: Partial<Record<RiderOrder['status'], { action: RiderAction; label: string; hint: string; icon: string }>> = {
  assigned: { action: 'picked_up', label: 'Picked up', hint: 'Go to the restaurant and collect the order.', icon: 'inventory_2' },
  picked_up: { action: 'on_the_way', label: 'Start delivery', hint: 'Order collected. Head to the customer.', icon: 'two_wheeler' },
  on_the_way: { action: 'delivered', label: 'Delivered', hint: 'Hand over the order and collect the cash.', icon: 'task_alt' },
};

/** The rider's home: availability, the request on offer, and the delivery in progress. */
@Component({
  selector: 'bb-delivery-dashboard',
  imports: [
    DecimalPipe,
    FormRoot,
    NP_FORM_FIELDS,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    ToggleComponent,
    EmptyState,
    OrderStatusChip,
    PageHeader,
    InrPipe,
  ],
  templateUrl: './delivery-dashboard.html',
  styleUrl: './delivery-dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeliveryDashboard {
  private readonly rider = inject(RiderService);
  private readonly geo = inject(GeolocationService);
  private readonly notify = inject(NotificationService);

  protected readonly data = signal<RiderDashboard | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly switching = signal(false);
  protected readonly acting = signal(false);
  protected readonly availabilityError = signal<string | null>(null);
  protected readonly lastLocationAt = signal<Date | null>(null);
  /** Ticks every second for the offer countdown. */
  protected readonly now = signal(Date.now());

  protected readonly profile = computed(() => this.data()?.profile ?? null);
  protected readonly online = computed(() => this.profile()?.isOnline ?? false);
  protected readonly offer = computed(() => this.data()?.offer ?? null);
  protected readonly active = computed(() => this.data()?.activeOrder ?? null);
  protected readonly nextStep = computed(() => {
    const status = this.active()?.status;
    return status ? (NEXT_STEP[status] ?? null) : null;
  });
  protected readonly vehicleLabel = VEHICLE_LABEL;

  /** Seconds left on the offer, and as a share of the full window (for the bar). */
  protected readonly offerSecondsLeft = computed(() => {
    const expires = this.offer()?.offerExpiresAt;
    return expires ? Math.max(0, Math.ceil((new Date(expires).getTime() - this.now()) / 1000)) : 0;
  });
  private offerWindow = 90;
  protected readonly offerProgress = computed(() => (this.offerSecondsLeft() / this.offerWindow) * 100);

  // Vehicle (first-time setup and edits) -------------------------------------
  protected readonly vehicleOptions: SelectOption[] = (Object.keys(VEHICLE_LABEL) as VehicleType[]).map((v) => ({
    value: v,
    label: VEHICLE_LABEL[v],
  }));
  protected readonly editingVehicle = signal(false);
  protected readonly vehicleModel = signal({ vehicleType: '', vehicleNumber: '' });
  protected readonly vehicleForm = form(
    this.vehicleModel,
    (path) => required(path.vehicleType, { message: 'Choose your vehicle' }),
    { submission: { action: () => this.saveVehicle() } },
  );
  protected readonly shownError = shownError;

  constructor() {
    pollWhileVisible(
      () =>
        this.rider.dashboard().pipe(
          catchError((err: unknown) => {
            this.loadError.set(errorMessage(err, 'Could not load your dashboard.'));
            return of(null);
          }),
        ),
      POLL_MS,
    )
      .pipe(takeUntilDestroyed())
      .subscribe((d) => d && this.apply(d));

    interval(1000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.now.set(Date.now()));

    // While online, keep our position fresh so nearby orders are offered to us.
    interval(LOCATION_EVERY_MS)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (this.online()) void this.reportLocation();
      });
  }

  private apply(d: RiderDashboard): void {
    const previousOffer = this.offer()?.id;
    this.loadError.set(null);
    this.data.set(d);
    if (d.offer && d.offer.id !== previousOffer) {
      this.offerWindow = Math.max(1, Math.round((new Date(d.offer.offerExpiresAt!).getTime() - Date.now()) / 1000));
      this.notify.info(`New delivery request from ${d.offer.restaurantSnapshot.name}`);
    }
    if (!d.profile.vehicleType && !this.editingVehicle()) this.editingVehicle.set(true);
  }

  protected editVehicle(): void {
    const p = this.profile();
    this.vehicleForm().reset({ vehicleType: p?.vehicleType ?? '', vehicleNumber: p?.vehicleNumber ?? '' });
    this.editingVehicle.set(true);
  }

  private async saveVehicle(): Promise<undefined> {
    const { vehicleType, vehicleNumber } = this.vehicleModel();
    try {
      const profile = await firstValueFrom(this.rider.saveVehicle(vehicleType as VehicleType, vehicleNumber.trim()));
      this.data.update((d) => (d ? { ...d, profile } : d));
      this.editingVehicle.set(false);
      this.notify.success('Vehicle saved');
    } catch (err) {
      this.notify.error(errorMessage(err));
    }
    return undefined;
  }

  /** Online needs a precise location (requests are offered by distance). */
  protected async setOnline(online: boolean): Promise<void> {
    this.switching.set(true);
    this.availabilityError.set(null);
    try {
      if (online) {
        const { latitude, longitude } = await this.geo.currentPrecise();
        this.apply(await firstValueFrom(this.rider.goOnline(latitude, longitude)));
        this.lastLocationAt.set(new Date());
        this.notify.success('You are online. Requests near you will appear here.');
      } else {
        this.apply(await firstValueFrom(this.rider.goOffline()));
      }
    } catch (err) {
      this.availabilityError.set(
        err instanceof ImpreciseLocationError
          ? "This device can't pinpoint where you are. Turn on GPS (or use your phone) to go online."
          : err instanceof Error // browser location errors carry a readable message
            ? err.message
            : errorMessage(err),
      );
      // Re-read the real state so the switch shows the truth.
      this.rider.dashboard().subscribe({ next: (d) => this.data.set(d), error: () => undefined });
    } finally {
      this.switching.set(false);
    }
  }

  private async reportLocation(): Promise<void> {
    try {
      const { latitude, longitude } = await this.geo.currentPrecise();
      await firstValueFrom(this.rider.reportLocation(latitude, longitude));
      this.lastLocationAt.set(new Date());
    } catch {
      // A missed update is fine; the next one will try again.
    }
  }

  protected accept(order: RiderOrder): void {
    this.act(this.rider.accept(order.id), 'Accepted. Head to the restaurant.');
  }

  protected decline(order: RiderOrder): void {
    this.act(this.rider.decline(order.id), 'Request declined');
  }

  protected advance(order: RiderOrder): void {
    const step = NEXT_STEP[order.status];
    if (step) this.act(this.rider.setStatus(order.id, step.action), step.action === 'delivered' ? 'Delivered. Nice work!' : step.label);
  }

  private act(request: ReturnType<RiderService['accept']>, message: string): void {
    this.acting.set(true);
    request.subscribe({
      next: (d) => {
        this.acting.set(false);
        this.apply(d);
        this.notify.success(message);
      },
      error: (err: unknown) => {
        this.acting.set(false);
        this.notify.error(errorMessage(err));
        this.rider.dashboard().subscribe({ next: (d) => this.apply(d), error: () => undefined });
      },
    });
  }

  protected itemCount(order: RiderOrder): number {
    return order.items.reduce((sum, i) => sum + i.quantity, 0);
  }

  /** Turn-by-turn directions on OpenStreetMap (in-app maps arrive with live tracking). */
  protected directionsUrl(order: RiderOrder): string | null {
    const from = order.restaurantSnapshot.location?.coordinates;
    const to = order.deliveryAddress.location?.coordinates;
    if (!from || !to) return null;
    const target = order.status === 'assigned' ? from : to;
    return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=;${target[1]},${target[0]}`;
  }
}
