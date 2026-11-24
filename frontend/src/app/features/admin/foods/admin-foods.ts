import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input } from '@angular/core';
import { ToggleComponent } from 'nexprime';
import {
  AdminCatalogService,
  AdminFoodItem,
} from '../../../core/services/admin/admin-catalog.service';
import { errorMessage } from '../../../shared/utils/api-error';
import { NotificationService } from '../../../core/services/notification.service';
import { confirmed } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { FilterSection } from '../../../shared/components/filter-panel/filter-panel.models';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { VegBadge } from '../../../shared/components/veg-badge/veg-badge';
import { filterOptions, filteredList } from '../../../shared/list/filtered-list';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import {
  BbCell,
  DataTable,
  TableAction,
  TableColumn,
} from '../../../shared/components/data-table/data-table';

@Component({
  selector: 'bb-admin-foods',
  imports: [
    ToggleComponent,
    ListToolbar,
    PageHeader,
    VegBadge,
    DataTable,
    BbCell,
  ],
  templateUrl: './admin-foods.html',
  styleUrl: './admin-foods.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminFoods implements OnInit {
  private readonly service = inject(AdminCatalogService);
  private readonly bbDialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);

  /** ?restaurant=<id> (the restaurant review's "Menu" link) preselects that restaurant. */
  readonly restaurant = input<string>();

  /** Names of the restaurants on this page, for a preselected restaurant's chip. */
  private readonly restaurantNames = computed(
    () =>
      new Map(
        (this.list.data()?.items ?? []).map((i) => [i.restaurant._id ?? i.restaurant.id ?? '', i.restaurant.name]),
      ),
  );

  protected readonly filterSections: FilterSection[] = [
    // Restaurants and categories that have dishes (the API's counts, with their names).
    { kind: 'options', key: 'restaurant', label: 'Restaurant', labelOf: (id) => this.restaurantNames().get(id) ?? id },
    { kind: 'options', key: 'category', label: 'Category' },
    { kind: 'options', key: 'type', label: 'Type', options: filterOptions({ veg: 'Veg', non_veg: 'Non-veg' }) },
    {
      kind: 'options',
      key: 'availability',
      label: 'Availability',
      options: filterOptions({ available: 'Available', unavailable: 'Unavailable' }),
    },
  ];

  protected readonly foods = filteredList((query) => this.service.foods(query), {
    errorText: 'Could not load dishes.',
    lazy: true,
  });
  protected readonly list = this.foods.list;

  protected readonly columns: TableColumn<AdminFoodItem>[] = [
    // The veg/non-veg marker and the name.
    { label: 'Dish', key: 'dish' },
    {
      label: 'Restaurant',
      value: (i) => i.restaurant.name,
      link: (i) => ['/admin/restaurants', i.restaurant._id ?? i.restaurant.id],
    },
    { label: 'Category', value: (i) => i.category.name },
    { label: 'Price', paise: (i) => i.pricePaise },
    { label: 'Available', key: 'available', align: 'center', nowrap: true },
  ];
  protected readonly actions: TableAction<AdminFoodItem>[] = [
    { icon: 'trash-2', label: 'Delete', run: (i) => this.remove(i) },
  ];

  ngOnInit(): void {
    const id = this.restaurant();
    if (id) this.foods.panel.set({ restaurant: [id] });
    this.list.load(1);
  }

  protected toggle(item: AdminFoodItem, checked: boolean): void {
    // Shown at once, restored if the save fails.
    const set = (isAvailable: boolean) =>
      this.list.update((items) => items.map((i) => (i.id === item.id ? { ...i, isAvailable } : i)));
    set(checked);
    this.service.setFoodAvailability(item.id, checked).subscribe({
      error: (err: unknown) => {
        set(!checked);
        this.notify.error(errorMessage(err));
      },
    });
  }

  protected remove(item: AdminFoodItem): void {
    confirmed(
      this.bbDialog,
      {
        title: `Delete “${item.name}”?`,
        message: `This removes it from ${item.restaurant.name}'s menu.`,
        confirmLabel: 'Delete',
        danger: true,
      },
      '420px',
    ).subscribe(() =>
      this.service.deleteFood(item.id).subscribe({
        next: () => {
          this.list.update((items) => items.filter((i) => i.id !== item.id));
          this.notify.success('Dish deleted');
        },
        error: (err: unknown) => this.notify.error(errorMessage(err)),
      }),
    );
  }
}
