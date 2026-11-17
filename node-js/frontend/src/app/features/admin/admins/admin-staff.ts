import { TableLabels } from '../../../shared/list/table-labels';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { form } from '@angular/forms/signals';
import { ButtonComponent, IconComponent, PaginationComponent, SelectOption } from 'nexprime';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminStaffService } from '../../../core/services/admin/admin-staff.service';
import { NotificationService } from '../../../core/services/notification.service';
import { openAccountStatus, statusChanged } from '../../../shared/components/account-status-dialog/account-status-dialog';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { NP_FORM_FIELDS } from '../../../shared/forms/np-form-fields';
import { pagedList } from '../../../shared/list/paged-list';
import {
  ADMIN_ROLES,
  AdminRole,
  ROLE_META,
  STAFF_ADMIN_ROLES,
  USER_STATUS_META,
  User,
  UserStatus,
} from '../../../shared/models/user.models';
import { openStaffForm } from './staff-form-dialog/staff-form-dialog';
import { openLoginHistory } from './login-history-dialog/login-history-dialog';
import { openPermissionEditor } from './permission-editor-dialog/permission-editor-dialog';
import { BbDialog } from '../../../shared/dialog/bb-dialog';

/** Super admin: create operations, finance and support admins and manage their access. */
@Component({
  selector: 'bb-admin-staff',
  imports: [
    TableLabels,
    DatePipe,
    NP_FORM_FIELDS,
    PaginationComponent,
    IconComponent,
    EmptyState,
    PageHeader,
    ButtonComponent,
  ],
  templateUrl: './admin-staff.html',
  styleUrl: './admin-staff.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminStaff {
  private readonly api = inject(AdminStaffService);
  private readonly bbDialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);
  protected readonly me = computed(() => this.auth.user()?.id);
  protected readonly roleLabel = (role: string) => ROLE_META[role as AdminRole]?.label ?? role;
  protected readonly isStaff = (u: User) =>
    (STAFF_ADMIN_ROLES as readonly string[]).includes(u.role);
  protected readonly statusMeta = USER_STATUS_META;

  protected readonly filterModel = signal({ search: '', role: '', status: '' });
  protected readonly filters = form(this.filterModel);
  protected readonly roleOptions: SelectOption[] = [
    { value: '', label: 'All admin roles' },
    ...ADMIN_ROLES.map((r) => ({ value: r, label: ROLE_META[r].label })),
  ];
  protected readonly statusOptions: SelectOption[] = [
    { value: '', label: 'All statuses' },
    ...(Object.keys(USER_STATUS_META) as UserStatus[]).map((s) => ({ value: s, label: USER_STATUS_META[s].label })),
  ];

  protected readonly list = pagedList(
    (page, limit) => {
      const f = this.filterModel();
      return this.api.list({
        search: f.search.trim() || undefined,
        role: (f.role || undefined) as AdminRole | undefined,
        status: (f.status || undefined) as UserStatus | undefined,
        page,
        limit,
      });
    },
    { filterKey: () => JSON.stringify(this.filterModel()), errorText: 'Could not load admins.' },
  );

  protected create(): void {
    openStaffForm(this.bbDialog, null).subscribe((user) => {
      if (!user) return;
      this.notify.success(`${user.name} can now sign in as ${this.roleLabel(user.role)}`);
      this.list.load(1);
      // An operator can do nothing until given permissions.
      if (user.role === 'operator') this.editPermissions(user);
    });
  }

  protected edit(user: User): void {
    openStaffForm(this.bbDialog, user).subscribe((saved) => {
      if (!saved) return;
      this.notify.success('Admin updated');
      this.list.reload();
    });
  }

  protected changeStatus(user: User): void {
    openAccountStatus(this.bbDialog, {
      user,
      kind: 'admins',
      save: (status, reason) => this.api.setStatus(user.id, status, reason),
    }).subscribe((updated) => {
      this.notify.success(statusChanged(updated));
      this.list.reload();
    });
  }

  protected editPermissions(user: User): void {
    openPermissionEditor(this.bbDialog, user).subscribe((saved) => {
      this.notify.success(`${saved.name}'s permissions saved`);
      this.list.reload();
    });
  }

  /** "Role preset" or "Own list of N". */
  protected permissionSummary(u: User): string {
    const n = u.permissions?.length ?? 0;
    return u.customPermissions == null && u.role !== 'operator' ? `Role preset · ${n}` : `Own list · ${n}`;
  }

  protected showLogins(user: User): void {
    openLoginHistory(this.bbDialog, user);
  }
}
