import { TabsComponent } from 'nexprime';
import { AuthService } from '../../../core/auth/auth.service';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input,
  signal,
  computed,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  RESTAURANT_ACTIONS,
  StatusAction,
  restaurantStatusChanger,
} from '../restaurant-accounts/restaurant-status';
import { finalize } from 'rxjs';
import { AdminCatalogService } from '../../../core/services/admin/admin-catalog.service';
import { ListEmpty } from '../../../shared/components/list-empty/list-empty';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { FilterSection } from '../../../shared/components/filter-panel/filter-panel.models';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { filterOptions, filteredList } from '../../../shared/list/filtered-list';
import { JOINED_SECTION } from '../filter-sections';
import { AdminRestaurant, RestaurantStatus } from '../../../core/models/catalog.models';
import {
  BbEmpty,
  DataTable,
  TableAction,
  TableColumn,
} from '../../../shared/components/data-table/data-table';

const TABS: { status: RestaurantStatus; label: string }[] = [
  { status: 'pending', label: 'Pending' },
  { status: 'approved', label: 'Approved' },
  { status: 'rejected', label: 'Rejected' },
  { status: 'resubmission_requested', label: 'Documents needed' },
  { status: 'suspended', label: 'Suspended' },
];

@Component({
  selector: 'bb-admin-restaurants',
  imports: [TabsComponent, ListEmpty, ListToolbar, PageHeader, DataTable, BbEmpty],
  templateUrl: './admin-restaurants.html',
  styleUrl: './admin-restaurants.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminRestaurants implements OnInit {
  private readonly service = inject(AdminCatalogService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly changeStatus = restaurantStatusChanger();

  readonly status = input<RestaurantStatus>();

  protected readonly tabs = TABS;
  protected readonly activeTab = signal(0);
  protected readonly counts = signal<Record<RestaurantStatus, number> | null>(null);

  protected readonly filterSections: FilterSection[] = [
    // Cities and cuisines come from the restaurants themselves (the API's counts).
    { kind: 'options', key: 'city', label: 'City' },
    { kind: 'options', key: 'cuisine', label: 'Cuisine' },
    {
      kind: 'options',
      key: 'veg',
      label: 'Food type',
      options: filterOptions({ pure_veg: 'Pure veg', mixed: 'Veg and non-veg' }),
    },
    {
      kind: 'options',
      key: 'accepting',
      label: 'Orders',
      options: filterOptions({ open: 'Taking orders', closed: 'Closed for orders' }),
    },
    JOINED_SECTION,
  ];

  /** The tab's status is fixed; the panel filters within it. Loads once the route's tab is known. */
  protected readonly restaurants = filteredList((query) => this.service.restaurants(query), {
    errorText: 'Could not load restaurants.',
    limit: 10,
    lazy: true,
    extra: () => ({ status: TABS[this.activeTab()].status }),
  });
  protected readonly list = this.restaurants.list;

  protected readonly columns: TableColumn<AdminRestaurant>[] = [
    {
      label: 'Restaurant',
      avatar: (r) => ({ name: r.name, imageUrl: r.imageUrl }),
      square: true,
      value: (r) => r.name,
      link: (r) => ['/admin/restaurants', r.id],
      sub: (r) => `${r.cuisines.join(', ')} · ${r.address.city}`,
    },
    { label: 'Owner', value: (r) => r.owner.name, sub: (r) => r.owner.email },
    { label: 'Submitted', date: (r) => r.createdAt, dateFormat: 'mediumDate', nowrap: true },
  ];
  /** The restaurant being suspended or reinstated (its button waits). */
  private readonly busyId = signal<string | null>(null);
  /** Approved restaurants can be suspended and suspended ones reinstated, as on the details page. */
  protected readonly actions = computed((): TableAction<AdminRestaurant>[] => {
    const status = TABS[this.activeTab()].status;
    const action =
      (status === 'approved' || status === 'suspended') && this.auth.can('restaurants:manage')
        ? RESTAURANT_ACTIONS[status][0]
        : null;
    return action
      ? [
          {
            icon: action.danger ? 'shield-alert' : 'rotate-ccw',
            text: true,
            label: action.label,
            danger: () => action.danger,
            disabled: (r) => this.busyId() === r.id,
            run: (r) => this.act(r, action),
          },
        ]
      : [];
  });

  ngOnInit(): void {
    const index = TABS.findIndex((t) => t.status === this.status());
    this.activeTab.set(index >= 0 ? index : 0);
    this.loadCounts();
    this.list.load(1);
  }

  /** The status tabs, with each status's count as the badge. */
  protected readonly tabItems = computed(() =>
    TABS.map((t) => ({
      id: t.status,
      label: t.label,
      content: '',
      badge: this.counts()?.[t.status],
    })),
  );

  protected selectTabId(id: string): void {
    const index = TABS.findIndex((t) => t.status === id);
    if (index >= 0 && index !== this.activeTab()) this.selectTab(index);
  }

  /** The list reloads on its own (the tab's status is part of its query). */
  protected selectTab(index: number): void {
    this.activeTab.set(index);
    void this.router.navigate([], {
      queryParams: { status: TABS[index].status },
      replaceUrl: true,
    });
  }

  private act(r: AdminRestaurant, action: StatusAction): void {
    this.busyId.set(r.id);
    this.changeStatus(r, action)
      .pipe(finalize(() => this.busyId.set(null)))
      .subscribe(() => {
        this.list.reload();
        this.loadCounts();
      });
  }

  protected loadCounts(): void {
    this.service
      .restaurantCounts()
      .subscribe({ next: (c) => this.counts.set(c), error: () => this.counts.set(null) });
  }
}
