import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import {
  AdminRestaurantAccountsService,
  RestaurantAccountRow,
} from '../../../core/services/admin/admin-restaurant-accounts.service';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { DataTable, TableColumn } from '../../../shared/components/data-table/data-table';
import { accountStatusBadge, ratingColumn, shortId, viewEditActions } from '../account-list';
import { JOINED_SECTION, KYC_SECTION, accountSorts, accountStatusSection } from '../filter-sections';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { FilterSection } from '../../../shared/components/filter-panel/filter-panel.models';
import { filterOptions, filteredList } from '../../../shared/list/filtered-list';
import { RESTAURANT_STATUS_LABEL, RESTAURANT_STATUS_TONE, kycStatusBadge } from './restaurant-status';

/**
 * Account management → Restaurant accounts: every restaurant partner with their restaurant,
 * owner, orders, rating, commission, approval, KYC and account status. Filters run on the server.
 */
@Component({
  selector: 'bb-admin-restaurant-accounts',
  imports: [PageHeader, ListToolbar, DataTable],
  templateUrl: './admin-restaurant-accounts.html',
  styleUrl: './admin-restaurant-accounts.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminRestaurantAccounts {
  private readonly api = inject(AdminRestaurantAccountsService);
  private readonly auth = inject(AuthService);

  protected readonly filterSections: FilterSection[] = [
    { kind: 'options', key: 'status', label: 'Approval status', options: filterOptions(RESTAURANT_STATUS_LABEL) },
    KYC_SECTION,
    accountStatusSection('accountStatus', 'Owner account'),
    // Cities come from the restaurants themselves (the API's counts).
    { kind: 'options', key: 'city', label: 'City' },
    JOINED_SECTION,
  ];
  protected readonly sortOptions = accountSorts({ orders: 'Most orders', rating: 'Highest rated' });

  protected readonly accounts = filteredList((query) => this.api.list(query), {
    errorText: 'Could not load restaurant accounts.',
    sort: 'newest',
  });
  protected readonly list = this.accounts.list;

  protected readonly columns: TableColumn<RestaurantAccountRow>[] = [
    {
      label: 'Restaurant',
      avatar: (r) => ({ name: r.name, imageUrl: r.imageUrl, icon: 'store' }),
      square: true,
      value: (r) => r.name,
      link: (r) => ['/admin/restaurant-accounts', r.id],
      sub: (r) => r.city,
      tag: (r) => shortId(r.id),
    },
    {
      label: 'Owner',
      value: (r) => r.owner?.name,
      sub: (r) => (r.owner ? [r.owner.email, r.owner.phone || 'No mobile'] : null),
      badge: (r) => r.owner && accountStatusBadge(r.owner, { onlyIfInactive: true }),
    },
    { label: 'Orders', value: (r) => r.stats.orders, align: 'end' },
    ratingColumn((r) => r.stats.rating),
    { label: 'Commission', value: (r) => `${r.commissionPercent}%`, align: 'end' },
    { label: 'Joined', date: (r) => r.createdAt, nowrap: true },
    {
      label: 'Status',
      badge: (r) => [
        {
          label: RESTAURANT_STATUS_LABEL[r.status],
          tone: RESTAURANT_STATUS_TONE[r.status],
          title: r.statusReason ?? '',
        },
        kycStatusBadge(r.kycStatus),
      ],
      sub: (r) => (r.status === 'approved' && !r.isAcceptingOrders ? 'Closed for orders' : null),
    },
  ];
  protected readonly actions = viewEditActions<RestaurantAccountRow>('/admin/restaurant-accounts', () =>
    this.auth.can('restaurants:edit'),
  );
}
