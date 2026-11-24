import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ButtonComponent } from 'nexprime';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminStaffService } from '../../../core/services/admin/admin-staff.service';
import { NotificationService } from '../../../core/services/notification.service';
import { openAccountStatus, statusChanged } from '../../../shared/components/account-status-dialog/account-status-dialog';
import {
  BbEmpty,
  DATE_TIME,
  DataTable,
  TableAction,
  TableColumn,
} from '../../../shared/components/data-table/data-table';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { FilterSection } from '../../../shared/components/filter-panel/filter-panel.models';
import { filteredList } from '../../../shared/list/filtered-list';
import { accountStatusSection, adminRoleSection } from '../filter-sections';
import { AdminRole, ROLE_META, STAFF_ADMIN_ROLES, User } from '../../../core/models/user.models';
import { accountStatusBadge } from '../account-list';
import { openStaffForm } from './staff-form-dialog/staff-form-dialog';
import { openLoginHistory } from './login-history-dialog/login-history-dialog';
import { openPermissionEditor } from './permission-editor-dialog/permission-editor-dialog';
import { BbDialog } from '../../../shared/dialog/bb-dialog';

/** Super admin: create operations, finance and support admins and manage their access. */
@Component({
  selector: 'bb-admin-staff',
  imports: [ListToolbar, DataTable, BbEmpty, EmptyState, PageHeader, ButtonComponent],
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

  protected readonly filterSections: FilterSection[] = [adminRoleSection('Role'), accountStatusSection('status', 'Status')];
  protected readonly admins = filteredList((query) => this.api.list(query), { errorText: 'Could not load admins.' });
  protected readonly list = this.admins.list;

  protected readonly columns: TableColumn<User>[] = [
    {
      label: 'Admin',
      value: (u) => u.name,
      strong: true,
      sub: (u) => `${u.email}${u.phone ? ' · ' + u.phone : ''}`,
      badge: (u) => (u.id === this.me() ? { label: 'You' } : null),
      inline: true,
    },
    {
      label: 'Role',
      align: 'center',
      badge: (u) => ({
        label: this.roleLabel(u.role),
        class: `bb-role-chip role-${u.role}`,
        title: this.isStaff(u) ? '' : 'Super admins are managed outside the panel',
      }),
    },
    {
      label: 'Permissions',
      sub: (u) => (u.role === 'admin' ? 'Everything' : this.permissionSummary(u)),
      nowrap: true,
    },
    { label: 'Status', align: 'center', badge: (u) => accountStatusBadge(u) },
    {
      label: 'Last sign-in',
      date: (u) => u.lastLoginAt,
      dateFormat: DATE_TIME,
      value: () => 'Never',
    },
  ];
  /** Staff admins only: not yourself, and super admins are managed outside the panel. */
  private readonly managed = (u: User) => this.isStaff(u) && u.id !== this.me();
  protected readonly actions: TableAction<User>[] = [
    { icon: 'pencil', label: 'View and edit', run: (u) => this.edit(u), show: this.managed },
    { icon: 'history', label: 'Sign-in history', run: (u) => this.showLogins(u), show: this.managed },
    { icon: 'key-round', label: 'Permissions', run: (u) => this.editPermissions(u), show: this.managed },
    { icon: 'shield-alert', label: 'Status', run: (u) => this.changeStatus(u), show: this.managed },
  ];

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
