import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Subscription, debounceTime, distinctUntilChanged, filter } from 'rxjs';
import { AdminCatalogService, AdminFoodItem } from '../../../core/services/admin/admin-catalog.service';
import { errorMessage } from '../../../core/services/api-error';
import { NotificationService } from '../../../core/services/notification.service';
import { ConfirmDialog, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { VegBadge } from '../../../shared/components/veg-badge/veg-badge';
import { Pagination } from '../../../shared/models/api.models';
import { InrPipe } from '../../../shared/pipes/money.pipes';

/** Platform-wide food item moderation: search, toggle availability, remove. */
@Component({
  selector: 'bb-admin-foods',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatSlideToggleModule,
    EmptyState,
    PageHeader,
    VegBadge,
    InrPipe,
  ],
  templateUrl: './admin-foods.html',
  styleUrl: './admin-foods.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminFoods implements OnInit {
  private readonly service = inject(AdminCatalogService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  /** Optional ?restaurant=<id> filter (linked from the restaurant review page). */
  readonly restaurant = input<string>();

  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly items = signal<AdminFoodItem[]>([]);
  protected readonly pagination = signal<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  private inFlight?: Subscription;

  constructor() {
    this.search.valueChanges.pipe(debounceTime(350), distinctUntilChanged(), takeUntilDestroyed()).subscribe(() => this.load(1));
  }

  ngOnInit(): void {
    this.load(1);
  }

  protected clearRestaurant(): void {
    void this.router.navigate([], { queryParams: {} }).then(() => this.load(1));
  }

  protected onPage(event: PageEvent): void {
    this.pagination.update((p) => ({ ...p, limit: event.pageSize }));
    this.load(event.pageIndex + 1);
  }

  protected load(page: number): void {
    this.inFlight?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.inFlight = this.service
      .foods({ search: this.search.value.trim() || undefined, restaurant: this.restaurant() || undefined, page, limit: this.pagination().limit })
      .subscribe({
        next: (res) => {
          this.items.set(res.items);
          this.pagination.set(res.pagination);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(errorMessage(err, 'Could not load dishes.'));
          this.loading.set(false);
        },
      });
  }

  protected toggle(item: AdminFoodItem, event: MatSlideToggleChange): void {
    this.service.setFoodAvailability(item.id, event.checked).subscribe({
      next: (updated) => this.items.update((list) => list.map((i) => (i.id === updated.id ? updated : i))),
      error: (err: unknown) => {
        event.source.checked = !event.checked;
        this.notify.error(errorMessage(err));
      },
    });
  }

  protected remove(item: AdminFoodItem): void {
    this.dialog
      .open<ConfirmDialog, ConfirmDialogData, true>(ConfirmDialog, {
        data: { title: `Delete “${item.name}”?`, message: `This removes it from ${item.restaurant.name}'s menu.`, confirmLabel: 'Delete', danger: true },
        width: '420px',
      })
      .afterClosed()
      .pipe(filter(Boolean))
      .subscribe(() =>
        this.service.deleteFood(item.id).subscribe({
          next: () => {
            this.items.update((list) => list.filter((i) => i.id !== item.id));
            this.notify.success('Dish deleted');
          },
          error: (err: unknown) => this.notify.error(errorMessage(err)),
        }),
      );
  }
}
