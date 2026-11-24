import { NpIconPipe } from '../../../shared/pipes/np-icon-name';
import { IconComponent } from 'nexprime';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs';
import { AdminCatalogService } from '../../../core/services/admin/admin-catalog.service';
import { errorMessage } from '../../../shared/utils/api-error';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import {
  AdminRestaurant,
  MenuStats,
  RestaurantStatus,
} from '../../../core/models/catalog.models';
import { InrPipe } from '../../../shared/pipes/money.pipes';
import { ClockTimePipe } from '../../../shared/pipes/clock-time.pipe';
import { ImageFallback, UsableImagePipe } from '../../../shared/directives/broken-images';
import { KycReview } from '../../../shared/components/kyc/kyc-review/kyc-review';
import {
  RESTAURANT_ACTIONS as ACTIONS,
  restaurantStatusChanger,
  RESTAURANT_STATUS_LABEL,
  StatusAction,
} from '../restaurant-accounts/restaurant-status';

@Component({
  selector: 'bb-admin-restaurant-review',
  imports: [
    DatePipe,
    RouterLink,
    IconComponent,
    NpIconPipe,
    EmptyState,
    InrPipe,
    ClockTimePipe,
    ImageFallback,
    UsableImagePipe,
    KycReview,
  ],
  templateUrl: './admin-restaurant-review.html',
  styleUrl: './admin-restaurant-review.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminRestaurantReview {
  private readonly service = inject(AdminCatalogService);

  readonly id = input.required<string>();

  protected readonly restaurant = signal<AdminRestaurant | null>(null);
  protected readonly stats = signal<MenuStats | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly acting = signal(false);
  private readonly changeStatus = restaurantStatusChanger();

  protected readonly statusLabel = RESTAURANT_STATUS_LABEL;
  protected readonly actions = computed(() => {
    const r = this.restaurant();
    return r ? ACTIONS[r.status] : [];
  });
  protected readonly mapLink = computed(() => {
    const r = this.restaurant();
    if (!r) return null;
    const [lng, lat] = r.location.coordinates;
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this.load(id));
    });
  }

  protected load(id = this.id()): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.restaurant(id).subscribe({
      next: ({ restaurant, stats }) => {
        this.restaurant.set(restaurant);
        this.stats.set(stats);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        if (err instanceof HttpErrorResponse && (err.status === 404 || err.status === 422))
          this.notFound.set(true);
        else this.error.set(errorMessage(err));
        this.loading.set(false);
      },
    });
  }

  protected act(action: StatusAction): void {
    const r = this.restaurant();
    if (!r) return;
    this.acting.set(true);
    this.changeStatus(r, action, () => this.load())
      .pipe(finalize(() => this.acting.set(false)))
      .subscribe((updated) => this.restaurant.set(updated));
  }
}
