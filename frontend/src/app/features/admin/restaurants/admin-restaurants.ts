import { IconComponent, PaginationComponent, TabsComponent } from 'nexprime';
import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AdminCatalogService } from '../../../core/services/admin/admin-catalog.service';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { FilterSection } from '../../../shared/components/filter-panel/filter-panel.models';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { filterOptions, filteredList } from '../../../shared/list/filtered-list';
import { JOINED_SECTION } from '../filter-sections';
import { RestaurantStatus } from '../../../core/models/catalog.models';
import { ImageFallback, UsableImagePipe } from '../../../shared/directives/broken-images';

const TABS: { status: RestaurantStatus; label: string }[] = [
  { status: 'pending', label: 'Pending' },
  { status: 'approved', label: 'Approved' },
  { status: 'rejected', label: 'Rejected' },
  { status: 'resubmission_requested', label: 'Documents needed' },
  { status: 'suspended', label: 'Suspended' },
];

@Component({
  selector: 'bb-admin-restaurants',
  imports: [
    DatePipe,
    RouterLink,
    IconComponent,
    PaginationComponent,
    TabsComponent,
    EmptyState,
    ListToolbar,
    PageHeader,
    ImageFallback,
    UsableImagePipe,
  ],
  templateUrl: './admin-restaurants.html',
  styleUrl: './admin-restaurants.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminRestaurants implements OnInit {
  private readonly service = inject(AdminCatalogService);
  private readonly router = inject(Router);

  readonly status = input<RestaurantStatus>();

  protected readonly tabs = TABS;
  protected readonly activeTab = signal(0);
  protected readonly counts = signal<Record<RestaurantStatus, number> | null>(null);

  protected readonly filterSections: FilterSection[] = [
    // Cities and cuisines come from the restaurants themselves (the API's counts).
    { kind: 'options', key: 'city', label: 'City' },
    { kind: 'options', key: 'cuisine', label: 'Cuisine' },
    { kind: 'options', key: 'veg', label: 'Food type', options: filterOptions({ pure_veg: 'Pure veg', mixed: 'Veg and non-veg' }) },
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

  protected loadCounts(): void {
    this.service
      .restaurantCounts()
      .subscribe({ next: (c) => this.counts.set(c), error: () => this.counts.set(null) });
  }
}
