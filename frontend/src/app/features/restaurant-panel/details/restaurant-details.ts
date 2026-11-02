import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError, debounceTime, distinctUntilChanged, filter, firstValueFrom, of, switchMap, tap } from 'rxjs';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatChipInputEvent, MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { errorMessage, fieldErrors } from '../../../core/services/api-error';
import { DeliveryLocationService, Place } from '../../../core/services/delivery-location.service';
import { GeolocationService, ImpreciseLocationError } from '../../../core/services/geolocation.service';
import { MyRestaurantService } from '../../../core/services/my-restaurant.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ImageUpload } from '../../../shared/components/image-upload/image-upload';
import { LatLng, MapPicker } from '../../../shared/components/map-picker/map-picker';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { Restaurant, RestaurantInput } from '../../../shared/models/catalog.models';
import { rupeesToPaise } from '../../../shared/pipes/money.pipes';
import { PHONE_PATTERN, applyServerErrors, controlError } from '../../../shared/validators/form-validators';
import { StatusBanner } from '../status-banner/status-banner';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Create or edit the partner's restaurant (business info, address, location, hours, pricing). */
@Component({
  selector: 'bb-restaurant-details',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    ImageUpload,
    MapPicker,
    PageHeader,
    StatusBanner,
  ],
  templateUrl: './restaurant-details.html',
  styleUrl: './restaurant-details.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestaurantDetails {
  private readonly service = inject(MyRestaurantService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  protected readonly geo = inject(GeolocationService);
  private readonly places = inject(DeliveryLocationService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly separatorKeys = [ENTER, COMMA] as const;
  protected readonly controlError = controlError;

  protected readonly restaurant = signal<Restaurant | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly locating = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly cuisines = signal<string[]>([]);
  protected readonly cuisineError = signal<string | null>(null);
  protected readonly imageUrl = signal('');

  // Map location (search / current location / drag the pin)
  protected readonly placeQuery = new FormControl('', { nonNullable: true });
  protected readonly placeResults = signal<Place[]>([]);
  protected readonly locationError = signal<string | null>(null);
  protected readonly showCoordinates = signal(false);
  private readonly placeSearchInput = viewChild<ElementRef<HTMLInputElement>>('placeSearchInput');

  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    description: ['', Validators.maxLength(1000)],
    phone: ['', [Validators.required, Validators.pattern(PHONE_PATTERN)]],
    email: ['', Validators.email],
    address: this.fb.group({
      line1: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(120)]],
      line2: ['', Validators.maxLength(120)],
      area: ['', Validators.maxLength(80)],
      city: ['', [Validators.required, Validators.minLength(2)]],
      state: ['', [Validators.required, Validators.minLength(2)]],
      postalCode: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9 -]{3,10}$/)]],
    }),
    location: this.fb.group({
      latitude: [null as number | null, [Validators.required, Validators.min(-90), Validators.max(90)]],
      longitude: [null as number | null, [Validators.required, Validators.min(-180), Validators.max(180)]],
    }),
    isPureVeg: [false],
    costForTwo: [null as number | null, [Validators.required, Validators.min(0), Validators.max(100000)]],
    minOrder: [0, [Validators.min(0), Validators.max(100000)]],
    avgPrepTimeMinutes: [25, [Validators.required, Validators.min(5), Validators.max(180)]],
    openingTime: ['10:00', [Validators.required, Validators.pattern(TIME)]],
    closingTime: ['23:00', [Validators.required, Validators.pattern(TIME)]],
  });

  constructor() {
    this.placeQuery.valueChanges
      .pipe(
        debounceTime(500),
        distinctUntilChanged(),
        tap((q) => q.trim().length < 3 && this.placeResults.set([])),
        filter((q) => q.trim().length >= 3),
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
      .subscribe((results) => this.placeResults.set(results));

    this.service.get().subscribe({
      next: ({ restaurant }) => {
        if (restaurant) this.fill(restaurant);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(errorMessage(err, 'Could not load your restaurant.'));
        this.loading.set(false);
      },
    });
  }

  private fill(r: Restaurant): void {
    this.restaurant.set(r);
    this.cuisines.set([...r.cuisines]);
    this.imageUrl.set(r.imageUrl ?? '');
    this.form.reset({
      name: r.name,
      description: r.description ?? '',
      phone: r.phone,
      email: r.email ?? '',
      address: { line1: r.address.line1, line2: r.address.line2 ?? '', area: r.address.area ?? '', city: r.address.city, state: r.address.state, postalCode: r.address.postalCode },
      location: { latitude: r.location.coordinates[1], longitude: r.location.coordinates[0] },
      isPureVeg: r.isPureVeg,
      costForTwo: r.costForTwoPaise / 100,
      minOrder: r.minOrderPaise / 100,
      avgPrepTimeMinutes: r.avgPrepTimeMinutes,
      openingTime: r.openingTime,
      closingTime: r.closingTime,
    });
  }

  protected addCuisine(event: MatChipInputEvent): void {
    const value = event.value.trim();
    event.chipInput.clear();
    if (!value) return;
    if (value.length < 2 || value.length > 40) {
      this.cuisineError.set('Each cuisine must be 2-40 characters');
      return;
    }
    if (this.cuisines().length >= 10) {
      this.cuisineError.set('Add at most 10 cuisines');
      return;
    }
    if (!this.cuisines().some((c) => c.toLowerCase() === value.toLowerCase())) {
      this.cuisines.update((list) => [...list, value]);
    }
    this.cuisineError.set(null);
  }

  protected removeCuisine(cuisine: string): void {
    this.cuisines.update((list) => list.filter((c) => c !== cuisine));
  }

  protected async useCurrentLocation(): Promise<void> {
    this.locating.set(true);
    this.locationError.set(null);
    try {
      const point = await this.geo.currentPrecise();
      await this.setPin(point);
    } catch (err) {
      // A vague reading would put the restaurant in the wrong place; ask for a search instead.
      this.locationError.set(err instanceof ImpreciseLocationError ? err.message : (err as Error).message);
      this.placeSearchInput()?.nativeElement.focus();
    } finally {
      this.locating.set(false);
    }
  }

  protected async pickPlace(place: Place): Promise<void> {
    this.placeResults.set([]);
    this.placeQuery.setValue('', { emitEvent: false });
    await this.setPin(place);
  }

  /** Sets the pin and fills empty address fields from it (never overwrites typed values). */
  protected async setPin({ latitude, longitude }: LatLng): Promise<void> {
    const location = this.form.controls.location;
    location.setValue({ latitude: +latitude.toFixed(6), longitude: +longitude.toFixed(6) });
    location.markAsDirty();
    location.markAsTouched();
    try {
      const place = await firstValueFrom(this.places.reverse(latitude, longitude));
      const address = this.form.controls.address.controls;
      const fill = (name: 'area' | 'city' | 'state' | 'postalCode', value?: string | null) => {
        if (value && !address[name].value.trim()) address[name].setValue(value);
      };
      fill('area', place.area);
      fill('city', place.city);
      fill('state', place.state);
      fill('postalCode', place.postalCode);
    } catch {
      // Naming the place is a convenience; the pin is what matters.
    }
  }

  protected save(): void {
    if (this.cuisines().length === 0) this.cuisineError.set('Add at least one cuisine');
    if (this.form.invalid || this.cuisines().length === 0) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const input: RestaurantInput = {
      name: v.name.trim(),
      description: v.description.trim(),
      cuisines: this.cuisines(),
      phone: v.phone.trim(),
      ...(v.email.trim() ? { email: v.email.trim() } : {}),
      address: {
        line1: v.address.line1.trim(),
        city: v.address.city.trim(),
        state: v.address.state.trim(),
        postalCode: v.address.postalCode.trim(),
        ...(v.address.line2.trim() ? { line2: v.address.line2.trim() } : {}),
        ...(v.address.area.trim() ? { area: v.address.area.trim() } : {}),
      },
      location: { latitude: Number(v.location.latitude), longitude: Number(v.location.longitude) },
      imageUrl: this.imageUrl(),
      isPureVeg: v.isPureVeg,
      costForTwoPaise: rupeesToPaise(Number(v.costForTwo)),
      minOrderPaise: rupeesToPaise(Number(v.minOrder ?? 0)),
      avgPrepTimeMinutes: Number(v.avgPrepTimeMinutes),
      openingTime: v.openingTime,
      closingTime: v.closingTime,
    };

    const creating = this.restaurant() === null;
    this.saving.set(true);
    this.error.set(null);
    (creating ? this.service.create(input) : this.service.update(input)).subscribe({
      next: (restaurant) => {
        this.fill(restaurant);
        this.saving.set(false);
        this.notify.success(creating ? 'Restaurant submitted for approval' : 'Restaurant details saved');
        if (creating) void this.router.navigateByUrl('/restaurant');
      },
      error: (err: unknown) => {
        applyServerErrors(this.form, fieldErrors(err));
        this.error.set(errorMessage(err, 'Could not save your restaurant.'));
        this.saving.set(false);
      },
    });
  }
}
