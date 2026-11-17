import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent, PaginationComponent, SelectOption } from 'nexprime';
import { AuthService } from '../../../core/auth/auth.service';
import {
  AdminUsersService,
  CustomerRow,
  CustomerSort,
  CustomerVerification,
} from '../../../core/services/admin/admin-users.service';
import { NotificationService } from '../../../core/services/notification.service';
import { openAccountStatus, statusChanged } from '../../../shared/components/account-status-dialog/account-status-dialog';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { NP_FORM_FIELDS } from '../../../shared/forms/np-form-fields';
import { TableLabels } from '../../../shared/list/table-labels';
import { USER_STATUS_META, UserStatus, initialsOf } from '../../../shared/models/user.models';
import { InrPipe } from '../../../shared/pipes/money.pipes';
import { accountList, selectOptions, shortId } from '../account-list';

/**
 * Account management → Customers: everyone who orders, with what they ordered and spent, their
 * account and verification status; search, filters and sorting run on the server.
 */
@Component({
  selector: 'bb-admin-customers',
  imports: [
    DatePipe,
    RouterLink,
    NP_FORM_FIELDS,
    IconComponent,
    PaginationComponent,
    PageHeader,
    InrPipe,
    TableLabels,
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

  protected readonly statusOptions = selectOptions('All statuses', USER_STATUS_META);
  protected readonly verificationOptions = selectOptions('Any verification', {
    email_verified: 'Email verified',
    email_unverified: 'Email not verified',
    phone_verified: 'Phone verified',
    phone_unverified: 'Phone not verified',
  });
  protected readonly sortOptions: SelectOption[] = [
    { value: 'newest', label: 'Newest first' },
    { value: 'oldest', label: 'Oldest first' },
    { value: 'name', label: 'Name A–Z' },
    { value: 'orders', label: 'Most orders' },
    { value: 'spent', label: 'Highest spending' },
  ];

  protected readonly accounts = accountList(
    {
      search: '',
      status: '' as UserStatus | '',
      verification: '' as CustomerVerification | '',
      joinedFrom: null as Date | null,
      joinedTo: null as Date | null,
      sort: 'newest' as CustomerSort,
    },
    (query) => this.api.customers(query),
    'Could not load customers.',
  );
  protected readonly filters = this.accounts.filters;
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
