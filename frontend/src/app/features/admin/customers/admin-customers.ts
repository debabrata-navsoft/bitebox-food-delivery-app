import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconComponent } from 'nexprime';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminUsersService, CustomerRow } from '../../../core/services/admin/admin-users.service';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { FilterSection } from '../../../shared/components/filter-panel/filter-panel.models';
import { filterOptions, filteredList } from '../../../shared/list/filtered-list';
import { NotificationService } from '../../../core/services/notification.service';
import { openAccountStatus, statusChanged } from '../../../shared/components/account-status-dialog/account-status-dialog';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import {
  BbCell,
  DataTable,
  TableAction,
  TableColumn,
} from '../../../shared/components/data-table/data-table';
import { accountStatusBadge, personColumn, viewEditActions } from '../account-list';
import { JOINED_SECTION, accountSorts, accountStatusSection } from '../filter-sections';

/**
 * Account management → Customers: everyone who orders, with what they ordered and spent, their
 * account and verification status; search, filters and sorting run on the server.
 */
@Component({
  selector: 'bb-admin-customers',
  imports: [IconComponent, PageHeader, ListToolbar, DataTable, BbCell],
  templateUrl: './admin-customers.html',
  styleUrl: './admin-customers.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCustomers {
  private readonly api = inject(AdminUsersService);
  private readonly dialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);

  protected readonly filterSections: FilterSection[] = [
    accountStatusSection('status', 'Account status'),
    {
      kind: 'options',
      key: 'verification',
      label: 'Verification',
      options: filterOptions({
        email_verified: 'Email verified',
        email_unverified: 'Email not verified',
        phone_verified: 'Phone verified',
        phone_unverified: 'Phone not verified',
      }),
    },
    JOINED_SECTION,
  ];
  protected readonly sortOptions = accountSorts({ orders: 'Most orders', spent: 'Highest spending' });

  protected readonly accounts = filteredList((query) => this.api.customers(query), {
    errorText: 'Could not load customers.',
    sort: 'newest',
  });
  protected readonly list = this.accounts.list;

  protected readonly columns: TableColumn<CustomerRow>[] = [
    personColumn('Customer', '/admin/customers'),
    { label: 'Mobile', value: (c) => c.phone },
    { label: 'Orders', value: (c) => c.stats.orders, align: 'end' },
    { label: 'Spent', paise: (c) => c.stats.spentPaise },
    { label: 'Joined', date: (c) => c.createdAt, nowrap: true },
    { label: 'Status', align: 'center', badge: (c) => accountStatusBadge(c) },
    // Email and phone icons, green once verified.
    { label: 'Verified', align: 'center', key: 'verified', nowrap: true },
  ];
  protected readonly actions: TableAction<CustomerRow>[] = [
    ...viewEditActions<CustomerRow>('/admin/customers', () => this.auth.can('customers:edit')),
    {
      icon: 'shield-alert',
      label: 'Change status',
      run: (c) => this.changeStatus(c),
      show: () => this.auth.can('customers:status') || this.auth.can('accounts:suspend'),
    },
  ];

  protected changeStatus(c: CustomerRow): void {
    openAccountStatus(this.dialog, {
      user: c,
      kind: 'customers',
      save: (status, reason) => this.api.setStatus(c.id, status, reason),
    }).subscribe((u) => {
      this.notify.success(statusChanged(u));
      this.list.reload();
    });
  }
}
