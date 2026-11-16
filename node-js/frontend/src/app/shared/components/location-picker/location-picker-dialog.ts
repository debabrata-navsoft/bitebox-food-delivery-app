import { NpIconPipe } from '../../icons/np-icon-name';
import { IconComponent } from 'nexprime';
import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Subscription, firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { AddressService } from '../../../core/services/checkout-api.service';
import {
  DeliveryLocation,
  DeliveryLocationService,
  Place,
} from '../../../core/services/delivery-location.service';
import {
  GeolocationService,
  ImpreciseLocationError,
} from '../../../core/services/geolocation.service';
import { DeliveryAddress } from '../../models/checkout.models';
import { LatLng, MapPicker } from '../map-picker/map-picker';
import { PlaceSearch } from '../place-search/place-search';

interface Candidate {
  latitude: number;
  longitude: number;
  label: string;
  detail?: string;
  source: DeliveryLocation['source'];
}

@Component({
  selector: 'bb-location-picker-dialog',
  imports: [
    PlaceSearch,
    MatDialogModule,
    MatButtonModule,
    IconComponent,
    NpIconPipe,
    MatProgressBarModule,
    MapPicker,
  ],
  templateUrl: './location-picker-dialog.html',
  styleUrl: './location-picker-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LocationPickerDialog {
  protected readonly location = inject(DeliveryLocationService);
  protected readonly geo = inject(GeolocationService);
  private readonly ref = inject(MatDialogRef<LocationPickerDialog>);
  private readonly auth = inject(AuthService);

  private readonly placeSearch = viewChild(PlaceSearch);
  protected readonly locating = signal(false);
  protected readonly gpsError = signal<string | null>(null);
  protected readonly addresses = signal<DeliveryAddress[]>([]);
  protected readonly isCustomer = computed(() => this.auth.role() === 'customer');

  protected readonly candidate = signal<Candidate | null>(null);
  /** The person's current location, found when the dialog opens (shown under the GPS button). */
  protected readonly detected = signal<Candidate | null>(null);
  protected readonly naming = signal(false);
  private naming$?: Subscription;

  constructor() {
    if (this.isCustomer()) {
      inject(AddressService)
        .list()
        .subscribe({ next: (list) => this.addresses.set(list), error: () => undefined });
    }
    // Find the current location as soon as the dialog opens, unless location was refused before
    // (then the button explains why when tapped, instead of a prompt on every open).
    afterNextRender(async () => {
      if (this.geo.supported && !(await this.geo.denied())) await this.detect(false);
    });
  }

  /** "Use my current location" (or the detected place under it): use what was found, finding it first if needed. */
  protected async useGps(): Promise<void> {
    if (!this.detected()) await this.detect(true);
    const d = this.detected();
    if (d) {
      this.location.choosePoint(d);
      this.ref.close(true);
    }
  }

  private async detect(asked: boolean): Promise<void> {
    if (this.locating()) return;
    this.locating.set(true);
    this.gpsError.set(null);
    try {
      const { latitude, longitude } = await this.geo.currentPrecise();
      // Without an address (lookup down), the coordinates stand in for it.
      const place = await firstValueFrom(this.location.reverse(latitude, longitude)).catch(() => null);
      this.detected.set({
        latitude,
        longitude,
        label: place?.label || 'Current location',
        detail: place?.displayName ?? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
        source: 'gps',
      });
    } catch (err) {
      this.gpsError.set(
        err instanceof ImpreciseLocationError
          ? err.message
          : `${(err as Error).message} Search for your area instead.`,
      );
      if (asked) this.placeSearch()?.focus();
    } finally {
      this.locating.set(false);
    }
  }

  protected pick(place: Place): void {
    this.candidate.set({
      latitude: place.latitude,
      longitude: place.longitude,
      label: place.label,
      detail: place.displayName,
      source: 'search',
    });
  }

  protected onPinMoved(point: LatLng): void {
    this.candidate.update((c) => (c ? { ...c, ...point } : c));
    this.name(point);
  }

  protected back(): void {
    this.candidate.set(null);
  }

  protected confirm(): void {
    const c = this.candidate();
    if (!c) return;
    this.location.choosePoint({
      latitude: c.latitude,
      longitude: c.longitude,
      label: c.label,
      detail: c.detail,
      source: c.source,
    });
    this.ref.close(true);
  }

  protected pickAddress(address: DeliveryAddress): void {
    this.location.chooseAddress(address);
    this.ref.close(true);
  }

  protected clear(): void {
    this.location.clear();
    this.ref.close(true);
  }

  private name(point: LatLng): void {
    this.naming$?.unsubscribe();
    this.naming.set(true);
    this.naming$ = this.location.reverse(point.latitude, point.longitude).subscribe({
      next: (place) => {
        this.candidate.update((c) =>
          c ? { ...c, label: place.label || c.label, detail: place.displayName } : c,
        );
        this.naming.set(false);
      },
      error: () => {
        this.candidate.update((c) =>
          c ? { ...c, detail: `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}` } : c,
        );
        this.naming.set(false);
      },
    });
  }
}
