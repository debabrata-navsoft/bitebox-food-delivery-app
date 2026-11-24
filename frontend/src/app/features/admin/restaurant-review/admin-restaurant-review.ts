import { NpIconPipe } from '../../../shared/pipes/np-icon-name';
import { DetailNav } from '../../../shared/components/detail-nav/detail-nav';
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
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs';
import { AdminCatalogService } from '../../../core/services/admin/admin-catalog.service';
import { errorMessage } from '../../../shared/utils/api-error';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { AdminRestaurant, MenuStats, RestaurantStatus } from '../../../core/models/catalog.models';
import { formatPaise } from '../../../shared/pipes/money.pipes';
import { formatClockTime } from '../../../shared/pipes/clock-time.pipe';
import { dateText } from '../../../shared/utils/dates';
import { ImageFallback, UsableImagePipe } from '../../../shared/directives/broken-images';
import { InfoRow, InfoRows } from '../../../shared/components/info-rows/info-rows';
import { KycReview } from '../../../shared/components/kyc/kyc-review/kyc-review';
import { openPhotoViewer } from '../../../shared/components/photo-viewer/photo-viewer';
import { MatDialog } from '@angular/material/dialog';
import {
  RESTAURANT_ACTIONS as ACTIONS,
  restaurantStatusChanger,
  RESTAURANT_STATUS_LABEL,
  RESTAURANT_STATUS_TONE,
  StatusAction,
} from '../restaurant-accounts/restaurant-status';

/** Photo tiles in the Photos card. */
const PHOTO_TILES = 8;

@Component({
  selector: 'bb-admin-restaurant-review',
  imports: [
    DetailNav,
    DatePipe,
    DecimalPipe,
    RouterLink,
    IconComponent,
    NpIconPipe,
    EmptyState,
    InfoRows,
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
  private readonly dialog = inject(MatDialog);

  private readonly dates = dateText();

  /** Everything on the page worked out once: quick facts, the sidebar lists and the photo tiles. */
  protected readonly view = computed(() => {
    const r = this.restaurant();
    if (!r) return null;
    const s = this.stats();
    const { day } = this.dates;
    const photos = [r.imageUrl, ...(r.photos ?? [])].filter((p): p is string => !!p);
    const more = photos.length - PHOTO_TILES;
    return {
      ownerId: r.owner.id ?? r.owner._id,
      kpis: [
        ...(s
          ? [
              {
                icon: 'utensils',
                label: 'Menu items',
                value: `${s.totalItems}`,
                note: `${s.availableItems} available`,
              },
              { icon: 'layout-grid', label: 'Categories', value: `${s.categoriesUsed}` },
            ]
          : []),
        { icon: 'users', label: 'Cost for two', value: formatPaise(r.costForTwoPaise) },
        {
          icon: 'shopping-bag',
          label: 'Minimum order',
          value: formatPaise(r.minOrderPaise) || '₹0',
        },
        { icon: 'timer', label: 'Avg. prep', value: `${r.avgPrepTimeMinutes} min` },
        {
          icon: 'clock',
          label: 'Hours',
          value: `${formatClockTime(r.openingTime)} – ${formatClockTime(r.closingTime)}`,
        },
      ] as InfoRow[],
      contact: [
        { icon: 'phone', label: 'Phone', value: r.phone },
        { icon: 'mail', label: 'Email', value: r.email || '—' },
      ],
      owner: [
        { icon: 'mail', label: 'Email', value: r.owner.email },
        { icon: 'phone', label: 'Phone', value: r.owner.phone || '—' },
      ],
      legal: [
        { icon: 'building-2', label: 'Legal name', value: r.ownerName || '—' },
        { icon: 'badge-check', label: 'FSSAI', value: r.fssaiNumber || 'Not given' },
        { icon: 'calendar', label: 'FSSAI valid until', value: day(r.fssaiValidUntil) || '—' },
        {
          icon: 'receipt',
          label: 'GST',
          value: r.gstRegistered ? (r.gstin ?? '—') : 'Not registered',
        },
      ],
      photos,
      // The cover first; the last tile reads "+N" when there are more photos than tiles.
      tiles: photos.slice(0, PHOTO_TILES).map((src, i) => ({
        src,
        cover: i === 0 && !!r.imageUrl,
        more: i === PHOTO_TILES - 1 && more > 0 ? more + 1 : 0,
      })),
    };
  });

  protected readonly statusLabel = RESTAURANT_STATUS_LABEL;
  protected readonly statusTone = RESTAURANT_STATUS_TONE;
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

  protected viewPhotos(index: number): void {
    openPhotoViewer(this.dialog, {
      images: this.view()?.photos ?? [],
      index,
      caption: this.restaurant()?.name,
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
