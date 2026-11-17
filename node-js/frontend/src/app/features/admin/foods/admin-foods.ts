import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, linkedSignal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent, IconComponent, PaginationComponent, ToggleComponent } from 'nexprime';
import {
  AdminCatalogService,
  AdminFoodItem,
} from '../../../core/services/admin/admin-catalog.service';
import { errorMessage } from '../../../core/services/api-error';
import { NotificationService } from '../../../core/services/notification.service';
import { confirmed } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { FilterSection } from '../../../shared/components/filter-panel/filter-panel.models';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { VegBadge } from '../../../shared/components/veg-badge/veg-badge';
import { filterOptions, filteredList } from '../../../shared/list/filtered-list';
import { InrPipe } from '../../../shared/pipes/money.pipes';
import { BbDialog } from '../../../shared/dialog/bb-dialog';

@Component({
  selector: 'bb-admin-foods',
  imports: [
    ToggleComponent,
    RouterLink,
    IconComponent,
    PaginationComponent,
    EmptyState,
    ListToolbar,
    PageHeader,
    VegBadge,
    InrPipe,
    ButtonComponent,
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
  /** The page's rows; availability changes and deletions apply here at once. */
  protected readonly items = linkedSignal<AdminFoodItem[]>(() => this.list.data()?.items ?? []);

  ngOnInit(): void {
    const id = this.restaurant();
    if (id) this.foods.panel.set({ restaurant: [id] });
    this.list.load(1);
  }

  protected toggle(item: AdminFoodItem, checked: boolean): void {
    const set = (isAvailable: boolean) =>
      this.items.update((list) => list.map((i) => (i.id === item.id ? { ...i, isAvailable } : i)));
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
          this.items.update((list) => list.filter((i) => i.id !== item.id));
          this.notify.success('Dish deleted');
        },
        error: (err: unknown) => this.notify.error(errorMessage(err)),
      }),
    );
  }
}
