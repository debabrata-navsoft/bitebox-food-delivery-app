import { BreakpointObserver } from '@angular/cdk/layout';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { form } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { IconComponent, PaginationComponent, SelectOption } from 'nexprime';
import { debounceTime, distinctUntilChanged, map, skip } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminUsersService } from '../../../core/services/admin/admin-users.service';
import { errorMessage } from '../../../core/services/api-error';
import { NotificationService } from '../../../core/services/notification.service';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { NP_FORM_FIELDS } from '../../../shared/forms/np-form-fields';
import { Pagination } from '../../../shared/models/api.models';
import {
  MEMBER_KIND,
  ROLE_META,
  Role,
  USER_STATUS_META,
  User,
  UserStatus,
} from '../../../shared/models/user.models';
import { openAccountStatus, statusChanged } from '../../../shared/components/account-status-dialog/account-status-dialog';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { selectOptions } from '../account-list';

const ROLE_TITLE = {
  customer: 'Customers',
  restaurant: 'Restaurant accounts',
  delivery: 'Delivery partner accounts',
};

@Component({
  selector: 'bb-admin-users',
  imports: [DatePipe, RouterLink, NP_FORM_FIELDS, IconComponent, PaginationComponent, PageHeader],
  templateUrl: './admin-users.html',
  styleUrl: './admin-users.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUsers implements OnInit {
  private readonly service = inject(AdminUsersService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);

  readonly role = input<Role>();

  protected readonly roleMeta = ROLE_META;
  protected readonly roleLabel = (role: Role) => ROLE_META[role].label;
  /** Admin accounts are managed in Admin management, not here. */
  protected readonly roles: Role[] = ['customer', 'restaurant', 'delivery'];

  protected readonly currentUserId = computed(() => this.auth.user()?.id);

  protected readonly roleOptions: SelectOption[] = [
    { value: '', label: 'All roles' },
    ...this.roles.map((r) => ({ value: r, label: ROLE_META[r].label })),
  ];

  protected readonly statusOptions = selectOptions('All statuses', USER_STATUS_META);
  protected readonly statusMeta = USER_STATUS_META;

  protected readonly filters = form(
    signal({ search: '', role: '' as Role | '', status: '' as UserStatus | '' }),
  );

  /** The sidebar's account links (?role=) title the page after that role. */
  protected readonly heading = computed(() => {
    const role = this.filters.role().value();
    return role
      ? { title: ROLE_TITLE[role as keyof typeof ROLE_TITLE], subtitle: `Every ${ROLE_META[role].label.toLowerCase()} account.` }
      : { title: 'Users', subtitle: 'Every BiteBox account across all roles.' };
  });

  protected readonly users = signal<User[]>([]);
  protected readonly pagination = signal<Pagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly isDesktop = toSignal(
    inject(BreakpointObserver)
      .observe('(min-width: 768px)')
      .pipe(map((s) => s.matches)),
    { initialValue: true },
  );

  constructor() {
    toObservable(this.role)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe((role) => this.filters.role().value.set(role && this.roles.includes(role) ? role : ''));
    toObservable(computed(() => this.filters.search().value().trim()))
      .pipe(skip(1), debounceTime(350), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.load(1));
    toObservable(this.filters.role().value)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.load(1));
    toObservable(this.filters.status().value)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.load(1));
  }

  ngOnInit(): void {
    const role = this.role();
    if (role && this.roles.includes(role)) this.filters.role().value.set(role);
    this.load(1);
  }

  /** np-pagination: `(pageChange)` → goTo(page); `(rowsChange)` → goTo(1, rows). */
  protected goTo(page: number, rows?: number): void {
    if (rows) this.pagination.update((p) => ({ ...p, limit: rows }));
    this.load(page);
  }

  protected load(page: number): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .list({
        page,
        limit: this.pagination().limit,
        search: this.filters.search().value().trim() || undefined,
        role: this.filters.role().value() || undefined,
        status: this.filters.status().value() || undefined,
      })
      .subscribe({
        next: (res) => {
          this.users.set(res.items);
          this.pagination.set(res.pagination);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(errorMessage(err, 'Could not load users.'));
          this.loading.set(false);
        },
      });
  }

  protected changeStatus(user: User): void {
    openAccountStatus(this.dialog, {
      user,
      kind: MEMBER_KIND[user.role as keyof typeof MEMBER_KIND],
      save: (status, reason) => this.service.setStatus(user.id, status, reason),
    }).subscribe((updated) => {
      this.notify.success(statusChanged(updated));
      this.users.update((list) => list.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
    });
  }
}
