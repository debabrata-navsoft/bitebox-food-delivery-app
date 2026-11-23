import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminUsersService } from '../../../core/services/admin/admin-users.service';
import { NotificationService } from '../../../core/services/notification.service';
import { MEMBER_KIND, Permission, ROLE_META, User } from '../../../core/models/user.models';
import {
  openAccountStatus,
  statusChanged,
} from '../../../shared/components/account-status-dialog/account-status-dialog';
import { FilterSection } from '../../../shared/components/filter-panel/filter-panel.models';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import {
  DataTable,
  TableAction,
  TableColumn,
} from '../../../shared/components/data-table/data-table';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { filterOptions, filteredList, optionsSection } from '../../../shared/list/filtered-list';
import { accountStatusBadge, personColumn, viewEditActions } from '../account-list';
import { JOINED_SECTION, accountSorts, accountStatusSection } from '../filter-sections';

type MemberRole = keyof typeof MEMBER_KIND;

/** Every customer, restaurant partner and rider account this admin may view, in one list. */
@Component({
  selector: 'bb-admin-users',
  imports: [PageHeader, ListToolbar, DataTable],
  templateUrl: './admin-users.html',
  styleUrl: './admin-users.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUsers {
  private readonly api = inject(AdminUsersService);
  private readonly dialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);

  protected readonly filterSections: FilterSection[] = [
    // Only the member roles this admin may view (the API refuses the others).
    optionsSection(
      'role',
      'Role',
      filterOptions(
        ROLE_META,
        Object.keys(MEMBER_KIND).filter((r) => this.may(r, 'view')),
      ),
    ),
    accountStatusSection('status', 'Account status'),
    JOINED_SECTION,
  ];
  protected readonly sortOptions = accountSorts({});

  protected readonly accounts = filteredList((query) => this.api.list(query), {
    errorText: 'Could not load users.',
    sort: 'newest',
  });
  protected readonly list = this.accounts.list;

  protected readonly columns: TableColumn<User>[] = [
    personColumn('User', '/admin/users'),
    { label: 'Mobile', value: (u) => u.phone },
    {
      label: 'Role',
      badge: (u) => ({ label: ROLE_META[u.role].label, class: `bb-role-chip role-${u.role}` }),
    },
    { label: 'Joined', date: (u) => u.createdAt, nowrap: true },
    { label: 'Status', badge: (u) => accountStatusBadge(u) },
  ];
  protected readonly actions: TableAction<User>[] = [
    ...viewEditActions<User>('/admin/users', (u) => this.may(u.role, 'edit')),
    {
      icon: 'shield-alert',
      label: 'Change status',
      run: (u) => this.changeStatus(u),
      show: (u) => this.may(u.role, 'status'),
    },
  ];

  /** `customers:edit`, `riders:status`…; suspending and blocking also come with accounts:suspend. */
  protected may(role: string, action: 'view' | 'edit' | 'status'): boolean {
    const kind = MEMBER_KIND[role as MemberRole];
    return (
      !!kind &&
      (this.auth.can(`${kind}:${action}` as Permission) ||
        (action === 'status' && this.auth.can('accounts:suspend')))
    );
  }

  protected changeStatus(user: User): void {
    openAccountStatus(this.dialog, {
      user,
      kind: MEMBER_KIND[user.role as MemberRole],
      save: (status, reason) => this.api.setStatus(user.id, status, reason),
    }).subscribe((u) => {
      this.notify.success(statusChanged(u));
      this.list.reload();
    });
  }
}
