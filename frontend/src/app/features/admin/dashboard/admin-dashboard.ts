import { NpIconPipe } from '../../../shared/pipes/np-icon-name';
import { IconComponent } from 'nexprime';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { rxResource } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, map, of } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminStaffService } from '../../../core/services/admin/admin-staff.service';
import { AdminUsersService } from '../../../core/services/admin/admin-users.service';
import { errorMessage } from '../../../shared/utils/api-error';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { StatTile } from '../../../shared/components/stat-tile/stat-tile';
import { ReviewShortcuts } from '../review-shortcuts/review-shortcuts';
import { ReportsService } from '../../../core/services/reports.service';
import { formatPaise } from '../../../shared/pipes/money.pipes';
import { Role } from '../../../core/models/user.models';

interface StatCard {
  role: Role;
  label: string;
  icon: string;
  value: number;
  link: string;
}

@Component({
  selector: 'bb-admin-dashboard',
  imports: [RouterLink, IconComponent, NpIconPipe, PageHeader, StatTile, ReviewShortcuts],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDashboard {
  private readonly users = inject(AdminUsersService);
  private readonly staff = inject(AdminStaffService);
  protected readonly user = inject(AuthService).user;

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly stats = signal<StatCard[]>([]);
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
    }).subscribe({
      next: (res) => {
        this.stats.set([
          { role: 'customer', label: 'Customers', icon: 'group', value: res.customer, link: '/admin/customers' },
          {
            role: 'restaurant',
            label: 'Restaurant accounts',
            icon: 'storefront',
            value: res.restaurant,
            link: '/admin/restaurant-accounts',
          },
          {
            role: 'delivery',
            label: 'Delivery partners',
            icon: 'two_wheeler',
            value: res.delivery,
            link: '/admin/delivery-partner-accounts',
          },
          { role: 'admin', label: 'Administrators', icon: 'shield_person', value: res.admin, link: '/admin/admins' },
        ]);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(errorMessage(err, 'Could not load dashboard data.'));
        this.loading.set(false);
      },
    });
  }
}
