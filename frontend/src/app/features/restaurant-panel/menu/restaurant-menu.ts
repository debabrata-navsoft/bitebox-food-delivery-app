import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, filter, of } from 'rxjs';
import { CatalogService } from '../../../core/services/catalog.service';
import { errorMessage } from '../../../core/services/api-error';
import { MyRestaurantService } from '../../../core/services/my-restaurant.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ConfirmDialog, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { VegBadge } from '../../../shared/components/veg-badge/veg-badge';
import { FoodItem, categoryIdOf } from '../../../shared/models/catalog.models';
import { InrPipe } from '../../../shared/pipes/money.pipes';
import { FoodFormDialog, FoodFormData } from '../food-form-dialog/food-form-dialog';

type AvailabilityFilter = 'all' | 'available' | 'unavailable';

@Component({
  selector: 'bb-restaurant-menu',
  imports: [
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatSelectModule,
    MatSlideToggleModule,
    EmptyState,
    PageHeader,
    VegBadge,
    InrPipe,
  ],
  templateUrl: './restaurant-menu.html',
  styleUrl: './restaurant-menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestaurantMenu implements OnInit {
  private readonly service = inject(MyRestaurantService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotificationService);

  /** Optional ?available=true from the dashboard stats link. */
  readonly available = input<string>();

  protected readonly categories = toSignal(inject(CatalogService).categories().pipe(catchError(() => of([]))), { initialValue: [] });
  protected readonly items = signal<FoodItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly noRestaurant = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly busyId = signal<string | null>(null);
  /** Total on the server, to warn if the menu is larger than what was loaded. */
  protected readonly total = signal(0);

  protected readonly search = signal('');
  protected readonly categoryFilter = signal('');
  protected readonly availabilityFilter = signal<AvailabilityFilter>('all');

  /** Filtering happens client-side: a single restaurant's menu is small (loaded up to 100 items). */
  protected readonly filtered = computed(() => {
    const term = this.search().trim().toLowerCase();
    const category = this.categoryFilter();
    const availability = this.availabilityFilter();
    return this.items().filter(
      (i) =>
        (!term || i.name.toLowerCase().includes(term)) &&
        (!category || categoryIdOf(i) === category) &&
        (availability === 'all' || (availability === 'available') === i.isAvailable),
    );
  });

  constructor() {
    this.load();
  }

  ngOnInit(): void {
    if (this.available() === 'true') this.availabilityFilter.set('available');
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.foods({ limit: 100 }).subscribe({
      next: (res) => {
        this.items.set(res.items);
        this.total.set(res.pagination.total);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        if (err instanceof HttpErrorResponse && err.status === 404) this.noRestaurant.set(true);
        else this.error.set(errorMessage(err, 'Could not load your menu.'));
        this.loading.set(false);
      },
    });
  }

  protected openForm(item?: FoodItem): void {
    this.dialog
      .open<FoodFormDialog, FoodFormData, FoodItem>(FoodFormDialog, {
        data: { item, categories: this.categories() },
        width: '560px',
        maxWidth: '95vw',
        autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .pipe(filter((saved): saved is FoodItem => !!saved))
      .subscribe((saved) => {
        this.items.update((list) =>
          item ? list.map((i) => (i.id === saved.id ? saved : i)) : [...list, saved].sort((a, b) => a.name.localeCompare(b.name)),
        );
        this.notify.success(item ? 'Dish saved' : 'Dish added to your menu');
      });
  }

  protected toggleAvailability(item: FoodItem, event: MatSlideToggleChange): void {
    this.busyId.set(item.id);
    this.service.setFoodAvailability(item.id, event.checked).subscribe({
      next: (updated) => {
        this.items.update((list) => list.map((i) => (i.id === updated.id ? updated : i)));
        this.busyId.set(null);
      },
      error: (err: unknown) => {
        event.source.checked = !event.checked;
        this.notify.error(errorMessage(err));
        this.busyId.set(null);
      },
    });
  }

  protected remove(item: FoodItem): void {
    this.dialog
      .open<ConfirmDialog, ConfirmDialogData, true>(ConfirmDialog, {
        data: { title: `Delete “${item.name}”?`, message: 'Customers will no longer see this dish.', confirmLabel: 'Delete', danger: true },
        width: '420px',
      })
      .afterClosed()
      .pipe(filter(Boolean))
      .subscribe(() => {
        this.busyId.set(item.id);
        this.service.deleteFood(item.id).subscribe({
          next: () => {
            this.items.update((list) => list.filter((i) => i.id !== item.id));
            this.notify.success('Dish deleted');
            this.busyId.set(null);
          },
          error: (err: unknown) => {
            this.notify.error(errorMessage(err));
            this.busyId.set(null);
          },
        });
      });
  }
}
