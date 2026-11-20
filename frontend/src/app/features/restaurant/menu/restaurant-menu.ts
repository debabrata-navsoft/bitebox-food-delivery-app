import { NpIconPipe } from '../../../shared/icons/np-icon-name';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, filter, of, tap } from 'rxjs';
import { CatalogService } from '../../../core/services/catalog.service';
import { errorMessage } from '../../../core/services/api-error';
import { MyRestaurantService } from '../../../core/services/my-restaurant.service';
import { NotificationService } from '../../../core/services/notification.service';
import { confirmed } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { VegBadge } from '../../../shared/components/veg-badge/veg-badge';
import { filteredList, optionsSection } from '../../../shared/list/filtered-list';
import { FoodItem } from '../../../shared/models/catalog.models';
import { InrPipe } from '../../../shared/pipes/money.pipes';
import { FoodFormDialog, FoodFormData } from '../food-form-dialog/food-form-dialog';
import {
  ButtonComponent,
  IconComponent,
  MenuComponent,
  type MenuItem,
  PaginationComponent,
  ToggleComponent,
} from 'nexprime';
import { ImageFallback, UsableImagePipe } from '../../../shared/images/broken-images';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import {
  COMPACT_MENU_WIDTH,
  toggleEndAligned,
} from '../../../shared/menu/end-aligned-menu';

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
    MenuComponent,
    PaginationComponent,
    EmptyState,
    ListToolbar,
    PageHeader,
    VegBadge,
    InrPipe,
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
  /** The page's rows; availability changes, edits and deletions apply here at once. */
  protected readonly items = linkedSignal<FoodItem[]>(() => this.list.data()?.items ?? []);

  protected readonly toggleMenu = (menu: MenuComponent, event: Event) =>
    toggleEndAligned(menu, event, COMPACT_MENU_WIDTH);
  /** Each dish's actions menu (built once per list change, not on every render). */
  protected readonly menus = computed(
    () =>
      new Map<string, MenuItem[]>(
        this.items().map((item) => [
          item.id,
          [
            { label: 'Edit', icon: 'pencil', command: () => this.openForm(item) },
            { label: 'Delete', icon: 'trash-2', command: () => this.remove(item) },
          ],
        ]),
      ),
  );
  protected readonly busyId = signal<string | null>(null);

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
        if (item) this.items.update((list) => list.map((i) => (i.id === saved.id ? saved : i)));
        else this.list.reload(); // where a new dish lands depends on the filters and the page
        this.notify.success(item ? 'Dish saved' : 'Dish added to your menu');
      });
  }

  protected toggleAvailability(item: FoodItem, checked: boolean): void {
    const set = (isAvailable: boolean) =>
      this.items.update((list) => list.map((i) => (i.id === item.id ? { ...i, isAvailable } : i)));
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
          this.items.update((list) => list.filter((i) => i.id !== item.id));
          if (!this.items().length) this.list.reload(); // the page emptied: fetch what is left
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
