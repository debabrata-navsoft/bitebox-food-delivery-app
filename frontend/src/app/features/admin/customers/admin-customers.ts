import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent, PaginationComponent } from 'nexprime';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminUsersService, CustomerRow } from '../../../core/services/admin/admin-users.service';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { FilterSection } from '../../../shared/components/filter-panel/filter-panel.models';
import { filterOptions, filteredList } from '../../../shared/list/filtered-list';
import { NotificationService } from '../../../core/services/notification.service';
import { openAccountStatus, statusChanged } from '../../../shared/components/account-status-dialog/account-status-dialog';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { TableLabels } from '../../../shared/directives/table-labels';
import { USER_STATUS_META, initialsOf } from '../../../core/models/user.models';
import { InrPipe } from '../../../shared/pipes/money.pipes';
import { shortId } from '../account-list';
import { JOINED_SECTION, accountSorts, accountStatusSection } from '../filter-sections';

/**
 * Account management → Customers: everyone who orders, with what they ordered and spent, their
 * account and verification status; search, filters and sorting run on the server.
 */
@Component({
  selector: 'bb-admin-customers',
  imports: [
    DatePipe,
    RouterLink,
    IconComponent,
    PaginationComponent,
    PageHeader,
    InrPipe,
    TableLabels,
    ListToolbar,
  ],
  templateUrl: './admin-customers.html',
  styleUrl: './admin-customers.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCustomers {
  private readonly api = inject(AdminUsersService);
  private readonly dialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);
  protected readonly auth = inject(AuthService);
  protected readonly statusMeta = USER_STATUS_META;
  protected readonly shortId = shortId;
  protected readonly initials = initialsOf;

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
