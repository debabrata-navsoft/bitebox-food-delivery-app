import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent, PaginationComponent } from 'nexprime';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminUsersService } from '../../../core/services/admin/admin-users.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  MEMBER_KIND,
  Permission,
  ROLE_META,
  USER_STATUS_META,
  User,
  initialsOf,
} from '../../../core/models/user.models';
import {
  openAccountStatus,
  statusChanged,
} from '../../../shared/components/account-status-dialog/account-status-dialog';
import { FilterSection } from '../../../shared/components/filter-panel/filter-panel.models';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { TableLabels } from '../../../shared/directives/table-labels';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { filterOptions, filteredList, optionsSection } from '../../../shared/list/filtered-list';
import { shortId } from '../account-list';
import { JOINED_SECTION, accountSorts, accountStatusSection } from '../filter-sections';

type MemberRole = keyof typeof MEMBER_KIND;

/** Every customer, restaurant partner and rider account this admin may view, in one list. */
@Component({
  selector: 'bb-admin-users',
  imports: [
    DatePipe,
    RouterLink,
    IconComponent,
    PaginationComponent,
    PageHeader,
    TableLabels,
    ListToolbar,
  ],
  templateUrl: './admin-users.html',
  styleUrl: './admin-users.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUsers {
  private readonly api = inject(AdminUsersService);
  private readonly dialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);
  protected readonly roleMeta = ROLE_META;
  protected readonly statusMeta = USER_STATUS_META;
  protected readonly shortId = shortId;
  protected readonly initials = initialsOf;

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
