import { NpIconPipe } from '../../../shared/icons/np-icon-name';
import { IconComponent } from 'nexprime';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { rxResource } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, map, of } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminStaffService } from '../../../core/services/admin/admin-staff.service';
import { AdminUsersService } from '../../../core/services/admin/admin-users.service';
import { errorMessage } from '../../../core/services/api-error';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { StatTile } from '../../../shared/components/stat-tile/stat-tile';
import { ReviewShortcuts } from '../review-shortcuts/review-shortcuts';
import { ReportsService } from '../../../core/services/reports.service';
import { formatPaise } from '../../../shared/pipes/money.pipes';
import { ROLE_META, Role, User } from '../../../shared/models/user.models';

interface StatCard {
  role: Role;
  label: string;
  icon: string;
  value: number;
}

@Component({
  selector: 'bb-admin-dashboard',
  imports: [DatePipe, RouterLink, IconComponent, NpIconPipe, PageHeader, StatTile, ReviewShortcuts],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDashboard {
  private readonly users = inject(AdminUsersService);
  private readonly staff = inject(AdminStaffService);
  protected readonly user = inject(AuthService).user;
  protected readonly roleMeta = ROLE_META;

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly stats = signal<StatCard[]>([]);
  protected readonly recent = signal<User[]>([]);
  private readonly reports = inject(ReportsService);
  protected readonly report = rxResource({ stream: () => this.reports.adminReport(30) });
  protected readonly formatPaise = formatPaise;
  /** Platform-wide figures; null when the API has no /admin/dashboard (the Node API). */
  protected readonly summary = rxResource({
    stream: () => this.staff.summary().pipe(catchError(() => of(null))),
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    forkJoin({
      customer: this.users.countByRole('customer'),
      restaurant: this.users.countByRole('restaurant'),
      delivery: this.users.countByRole('delivery'),
      admin: this.staff.list({ limit: 1 }).pipe(map((page) => page.pagination.total)),
      recent: this.users.list({ limit: 5 }),
    }).subscribe({
      next: (res) => {
        this.stats.set([
          { role: 'customer', label: 'Customers', icon: 'group', value: res.customer },
          {
            role: 'restaurant',
            label: 'Restaurant accounts',
            icon: 'storefront',
            value: res.restaurant,
          },
          {
            role: 'delivery',
            label: 'Delivery partners',
            icon: 'two_wheeler',
            value: res.delivery,
          },
          { role: 'admin', label: 'Administrators', icon: 'shield_person', value: res.admin },
        ]);
        this.recent.set(res.recent.items);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(errorMessage(err, 'Could not load dashboard data.'));
        this.loading.set(false);
      },
    });
  }
}
