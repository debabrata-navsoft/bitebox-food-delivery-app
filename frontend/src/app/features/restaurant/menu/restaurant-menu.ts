import { NpIconPipe } from '../../../shared/pipes/np-icon-name';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, filter, of, tap } from 'rxjs';
import { CatalogService } from '../../../core/services/catalog.service';
import { errorMessage } from '../../../shared/utils/api-error';
import { MyRestaurantService } from '../../../core/services/my-restaurant.service';
import { NotificationService } from '../../../core/services/notification.service';
import { confirmed } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { VegBadge } from '../../../shared/components/veg-badge/veg-badge';
import { filteredList, optionsSection } from '../../../shared/list/filtered-list';
import { FoodItem } from '../../../core/models/catalog.models';
import { FoodFormDialog, FoodFormData } from '../food-form-dialog/food-form-dialog';
import { ButtonComponent, IconComponent, ToggleComponent } from 'nexprime';
import {
  BbCell,
  DataTable,
  TableAction,
  TableColumn,
} from '../../../shared/components/data-table/data-table';
import { ImageFallback, UsableImagePipe } from '../../../shared/directives/broken-images';
import { BbDialog } from '../../../shared/dialog/bb-dialog';

/**
 * The partner's menu: a paged list filtered on the server (search plus the Filters panel's
 * category, type and availability, with live counts), availability toggles and the dish form.
 */
@Component({
  selector: 'bb-restaurant-menu',
  imports: [
    ToggleComponent,
    RouterLink,
    ButtonComponent,
    IconComponent,
    NpIconPipe,
    DataTable,
    BbCell,
    EmptyState,
    ListToolbar,
    PageHeader,
    VegBadge,
    ImageFallback,
    UsableImagePipe,
  ],
  templateUrl: './restaurant-menu.html',
  styleUrl: './restaurant-menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestaurantMenu implements OnInit {
  private readonly service = inject(MyRestaurantService);
  private readonly bbDialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);

  /** ?available=true (the dashboard's "available dishes" card) preselects available dishes. */
  readonly available = input<string>();

  protected readonly categories = toSignal(
    inject(CatalogService)
      .categories()
      .pipe(catchError(() => of([]))),
    { initialValue: [] },
  );
  private readonly categoryNames = computed(() => new Map(this.categories().map((c) => [c.id, c.name])));

  protected readonly filterSections = [
    // The categories this menu uses (the API's counts, with their names).
    optionsSection('category', 'Category', (id) => this.categoryNames().get(id) ?? id),
    optionsSection('type', 'Type', { veg: 'Veg', non_veg: 'Non-veg' }),
    optionsSection('availability', 'Availability', { available: 'Available', unavailable: 'Unavailable' }),
  ];

  /** No restaurant yet: the API answers 404. */
  protected readonly noRestaurant = signal(false);
  protected readonly menu = filteredList(
    (query) =>
      this.service.foods(query).pipe(
        tap({
          error: (err: unknown) => {
            if (err instanceof HttpErrorResponse && err.status === 404) this.noRestaurant.set(true);
          },
        }),
      ),
    { errorText: 'Could not load your menu.', limit: 50, lazy: true },
  );
  protected readonly list = this.menu.list;
  protected readonly busyId = signal<string | null>(null);

  protected readonly columns: TableColumn<FoodItem>[] = [
    { label: 'Dish', key: 'dish' },
    { label: 'Category', value: (i) => i.category.name },
    { label: 'Price', paise: (i) => i.pricePaise },
    { label: 'Available', key: 'available', align: 'center', nowrap: true },
  ];
  /** Edit and Delete in a "⋮" menu (availability changes, edits and deletions show at once). */
  protected readonly actions: TableAction<FoodItem>[] = [
    {
      icon: 'ellipsis-vertical',
      label: 'Actions',
      disabled: (i) => this.busyId() === i.id,
      menu: (i) => [
        { label: 'Edit', icon: 'pencil', command: () => this.openForm(i) },
        { label: 'Delete', icon: 'trash-2', command: () => this.remove(i) },
      ],
    },
  ];

  ngOnInit(): void {
    if (this.available() === 'true') this.menu.panel.set({ availability: ['available'] });
    this.list.load(1);
  }

  protected openForm(item?: FoodItem): void {
    this.bbDialog
      .open<FoodFormDialog, FoodFormData, FoodItem>(FoodFormDialog, {
        data: { item, categories: this.categories() },
        width: '560px',
      })
      .closed
      .pipe(filter((saved): saved is FoodItem => !!saved))
      .subscribe((saved) => {
        if (item) this.list.update((list) => list.map((i) => (i.id === saved.id ? saved : i)));
        else this.list.reload(); // where a new dish lands depends on the filters and the page
        this.notify.success(item ? 'Dish saved' : 'Dish added to your menu');
      });
  }

  protected toggleAvailability(item: FoodItem, checked: boolean): void {
    const set = (isAvailable: boolean) =>
      this.list.update((list) => list.map((i) => (i.id === item.id ? { ...i, isAvailable } : i)));
    set(checked);
    this.busyId.set(item.id);
    this.service.setFoodAvailability(item.id, checked).subscribe({
      next: () => this.busyId.set(null),
      error: (err: unknown) => {
        set(!checked);
        this.notify.error(errorMessage(err));
        this.busyId.set(null);
      },
    });
  }

  protected remove(item: FoodItem): void {
    confirmed(
      this.bbDialog,
      {
        title: `Delete “${item.name}”?`,
        message: 'Customers will no longer see this dish.',
        confirmLabel: 'Delete',
        danger: true,
      },
      '420px',
    ).subscribe(() => {
      this.busyId.set(item.id);
      this.service.deleteFood(item.id).subscribe({
        next: () => {
          this.list.update((list) => list.filter((i) => i.id !== item.id));
          if (!this.list.data()?.items.length) this.list.reload(); // the page emptied: fetch what is left
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
