import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { catchError, debounceTime, distinctUntilChanged, filter, firstValueFrom, of, switchMap, tap } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { errorMessage, fieldErrors } from '../../../core/services/api-error';
import { AddressService } from '../../../core/services/checkout-api.service';
import { DeliveryLocationService, Place } from '../../../core/services/delivery-location.service';
import { GeolocationService, ImpreciseLocationError } from '../../../core/services/geolocation.service';
import { LatLng, MapPicker } from '../map-picker/map-picker';
import { AddressInput, AddressLabel, DeliveryAddress } from '../../models/checkout.models';
import { PHONE_PATTERN, applyServerErrors, controlError } from '../../validators/form-validators';

type AutoField = 'area' | 'city' | 'state' | 'postalCode';

/**
 * Add or edit a delivery address. The location can be set by place search,
 * the browser's current location, or by dragging the pin on a map; the
 * address fields are then filled from the pinned point.
 * Closes with the saved address.
 */
@Component({
  selector: 'bb-address-form-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MapPicker,
  ],
  templateUrl: './address-form-dialog.html',
  styleUrl: './address-form-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddressFormDialog {
  protected readonly data = inject<DeliveryAddress | null>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<AddressFormDialog, DeliveryAddress>);
  private readonly service = inject(AddressService);
  protected readonly geo = inject(GeolocationService);
  private readonly places = inject(DeliveryLocationService);
  private readonly user = inject(AuthService).user;
  protected readonly controlError = controlError;

  protected readonly saving = signal(false);
  protected readonly locating = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly locationError = signal<string | null>(null);
  /** Short description of the pinned point (from reverse geocoding). */
  protected readonly pinLabel = signal<string | null>(null);
  /** Raw coordinate inputs are tucked away unless GPS is unavailable. */
  protected readonly showCoordinates = signal(!this.geo.supported);
  protected readonly triedSave = signal(false);

  protected readonly placeQuery = new FormControl('', { nonNullable: true });
  private readonly placeSearchInput = viewChild<ElementRef<HTMLInputElement>>('placeSearchInput');
  protected readonly placeResults = signal<Place[]>([]);
  protected readonly searching = signal(false);

  /** Values this dialog filled in automatically; only these may be replaced when the pin moves. */
  private readonly autoFilled = new Map<AutoField, string>();

  protected readonly form = inject(FormBuilder).nonNullable.group({
    label: [(this.data?.label ?? 'home') as AddressLabel],
    recipientName: [this.data?.recipientName ?? this.user()?.name ?? '', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    phone: [this.data?.phone ?? this.user()?.phone ?? '', [Validators.required, Validators.pattern(PHONE_PATTERN)]],
    line1: [this.data?.line1 ?? '', [Validators.required, Validators.minLength(3), Validators.maxLength(120)]],
    line2: [this.data?.line2 ?? '', Validators.maxLength(120)],
    area: [this.data?.area ?? '', Validators.maxLength(80)],
    landmark: [this.data?.landmark ?? '', Validators.maxLength(80)],
    city: [this.data?.city ?? '', [Validators.required, Validators.minLength(2)]],
    state: [this.data?.state ?? '', [Validators.required, Validators.minLength(2)]],
    postalCode: [this.data?.postalCode ?? '', [Validators.required, Validators.pattern(/^[A-Za-z0-9 -]{3,10}$/)]],
    latitude: [this.data ? this.data.location.coordinates[1] : (null as number | null), [Validators.required, Validators.min(-90), Validators.max(90)]],
    longitude: [this.data ? this.data.location.coordinates[0] : (null as number | null), [Validators.required, Validators.min(-180), Validators.max(180)]],
    isDefault: [this.data?.isDefault ?? false],
  });

  constructor() {
    this.placeQuery.valueChanges
      .pipe(
        debounceTime(500),
        distinctUntilChanged(),
        tap((q) => {
          if (q.trim().length < 3) this.placeResults.set([]);
        }),
        filter((q) => q.trim().length >= 3),
        tap(() => this.searching.set(true)),
        switchMap((q) =>
          this.places.search(q.trim()).pipe(
            catchError((err: unknown) => {
              this.locationError.set(errorMessage(err, 'Place search failed.'));
              return of([] as Place[]);
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((results) => {
        this.placeResults.set(results);
        this.searching.set(false);
      });
  }

  protected pinned(): boolean {
    const { latitude, longitude } = this.form.controls;
    return latitude.value !== null && longitude.value !== null && latitude.valid && longitude.valid;
  }

  protected async useCurrentLocation(): Promise<void> {
    this.locating.set(true);
    this.locationError.set(null);
    this.placeResults.set([]);
    try {
      const { latitude, longitude } = await this.geo.currentPrecise();
      await this.setPin({ latitude, longitude });
    } catch (err) {
      // Never pin a vague reading: it would show a place the customer is not at.
      this.locationError.set(err instanceof ImpreciseLocationError ? err.message : `${(err as Error).message} Search for your area or tap the map instead.`);
      this.placeSearchInput()?.nativeElement.focus();
    } finally {
      this.locating.set(false);
    }
  }

  protected async pickPlace(place: Place): Promise<void> {
    this.placeResults.set([]);
    this.placeQuery.setValue('', { emitEvent: false });
    await this.setPin({ latitude: place.latitude, longitude: place.longitude });
  }

  /** The user dragged the pin or tapped the map: that is the exact spot. */
  protected async onPinMoved(point: LatLng): Promise<void> {
    await this.setPin(point);
  }

  private async setPin({ latitude, longitude }: LatLng): Promise<void> {
    this.form.patchValue({ latitude: +latitude.toFixed(6), longitude: +longitude.toFixed(6) });
    this.form.controls.latitude.markAsDirty();
    await this.fillFromCoordinates(latitude, longitude);
  }

  /**
   * Fills area / city / state / PIN from the pinned point. Fields the user typed
   * are never overwritten; fields we filled earlier are updated when the pin moves.
   */
  private async fillFromCoordinates(latitude: number, longitude: number): Promise<void> {
    try {
      const place = await firstValueFrom(this.places.reverse(latitude, longitude));
      this.pinLabel.set(place.displayName ?? place.label);
      const fill = (name: AutoField, value?: string | null) => {
        const control = this.form.controls[name];
        const current = control.value.trim();
        const ours = this.autoFilled.get(name);
        if (!value || (current && current !== ours)) return;
        control.setValue(value);
        this.autoFilled.set(name, value);
      };
      fill('area', place.area);
      fill('city', place.city);
      fill('state', place.state);
      fill('postalCode', place.postalCode);
    } catch {
      // Naming the place is a convenience; the pin itself is what matters.
      this.pinLabel.set(null);
    }
  }

  protected save(): void {
    this.triedSave.set(true);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      // Make a missing pin visible even when the coordinate inputs are hidden.
      if (!this.pinned() && !this.geo.supported) this.showCoordinates.set(true);
      if (!this.pinned()) this.error.set('Pin your delivery location first (use your current location or enter coordinates).');
      return;
    }
    const v = this.form.getRawValue();
    // Optional fields are always sent (possibly empty) so clearing one in an edit really clears it.
    const optional = (value: string) => value.trim();
    const input: AddressInput = {
      label: v.label,
      recipientName: v.recipientName.trim(),
      phone: v.phone.trim(),
      line1: v.line1.trim(),
      line2: optional(v.line2),
      area: optional(v.area),
      landmark: optional(v.landmark),
      city: v.city.trim(),
      state: v.state.trim(),
      postalCode: v.postalCode.trim(),
      location: { latitude: Number(v.latitude), longitude: Number(v.longitude) },
      isDefault: v.isDefault,
    };
    this.saving.set(true);
    this.error.set(null);
    (this.data ? this.service.update(this.data.id, input) : this.service.create(input)).subscribe({
      next: (address) => this.ref.close(address),
      error: (err: unknown) => {
        applyServerErrors(this.form, fieldErrors(err).map((e) => ({ ...e, field: e.field.replace('location.', '') })));
        this.error.set(errorMessage(err));
        this.saving.set(false);
      },
    });
  }
}
