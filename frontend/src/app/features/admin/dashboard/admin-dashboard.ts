import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IconComponent } from 'nexprime';
import { catchError, forkJoin, map, of } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminStaffService } from '../../../core/services/admin/admin-staff.service';
import { AdminUsersService } from '../../../core/services/admin/admin-users.service';
import { ReportsService } from '../../../core/services/reports.service';
import { formatPaise } from '../../../shared/pipes/money.pipes';
import { errorMessage } from '../../../shared/utils/api-error';
import { ReviewShortcuts } from '../review-shortcuts/review-shortcuts';

const money = (paise: number) => formatPaise(paise) || '₹0';
/** Each part's share of the whole, in % (a bar's segment widths); none when the whole is 0. */
const shares = (parts: number[]) => {
  const total = parts.reduce((a, b) => a + b, 0);
  return parts.map((n) => (total ? (n / total) * 100 : 0));
};

/**
 * The super admin's home as a bento grid: revenue with a 30-day trend, live orders, the order
 * mix, pending settlements, the last 30 days and the accounts.
 */
@Component({
  selector: 'bb-admin-dashboard',
  imports: [DatePipe, RouterLink, IconComponent, ReviewShortcuts],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDashboard {
  private readonly users = inject(AdminUsersService);
  private readonly staff = inject(AdminStaffService);
  private readonly reports = inject(ReportsService);
  private readonly user = inject(AuthService).user;

  protected readonly today = new Date();
  protected readonly firstName = computed(() => this.user()?.name?.split(' ')[0] ?? 'Admin');
  protected readonly money = money;

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly accounts = signal<
    { icon: string; label: string; value: number; link: string }[]
  >([]);
  protected readonly report = rxResource({ stream: () => this.reports.adminReport(30) });
  /** Platform-wide figures; null when the API has none. */
  protected readonly summary = rxResource({
    stream: () => this.staff.summary().pipe(catchError(() => of(null))),
  });

  /** Delivered, active and cancelled as shares of all orders (the order mix bar). */
  protected readonly mix = computed(() => {
    const o = this.summary.value()?.orders;
    if (!o) return [];
    const [delivered, active, cancelled] = shares([o.completed, o.active, o.cancelled]);
    return [
      { label: 'Delivered', value: o.completed, share: delivered, tone: 'success' },
      { label: 'Active', value: o.active, share: active, tone: 'teal' },
      { label: 'Cancelled', value: o.cancelled, share: cancelled, tone: 'danger' },
    ];
  });

  /** Pending settlements split between restaurants and riders. */
  protected readonly owed = computed(() => {
    const m = this.summary.value()?.money;
    if (!m) return null;
    const [restaurants, riders] = shares([m.pendingRestaurantPaise, m.pendingRiderPaise]);
    return { total: m.pendingSettlementsPaise, restaurants, riders, m };
  });

  /** The 30 days' delivered value as an SVG line (0–100 wide, 0–40 high) and its filled area. */
  protected readonly trend = computed(() => {
    const days = this.report.hasValue() ? this.report.value().daily : [];
    if (days.length < 2) return null;
    const max = Math.max(...days.map((d) => d.gmvPaise), 1);
    const points = days.map(
      (d, i) => `${(i / (days.length - 1)) * 100},${38 - (d.gmvPaise / max) * 34}`,
    );
    return { line: points.join(' '), area: `0,40 ${points.join(' ')} 100,40` };
  });

  /** The last 30 days in small tiles. */
  protected readonly month = computed(() => {
    if (!this.report.hasValue()) return [];
    const t = this.report.value().totals;
    return [
      { icon: 'banknote', label: 'Delivered value', value: money(t.gmvPaise), tone: 'plum' },
      {
        icon: 'landmark',
        label: 'Platform revenue',
        value: money(t.platformRevenuePaise),
        tone: 'amber',
      },
      {
        icon: 'receipt-text',
        label: 'Orders placed',
        value: `${t.orders}`,
        tone: 'info',
        hint: `${t.delivered} delivered`,
      },
      { icon: 'user-plus', label: 'New customers', value: `${t.newCustomers}`, tone: 'success' },
    ];
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
      next: (n) => {
        this.accounts.set([
          { icon: 'users', label: 'Customers', value: n.customer, link: '/admin/customers' },
          {
            icon: 'store',
            label: 'Restaurant accounts',
            value: n.restaurant,
            link: '/admin/restaurant-accounts',
          },
          {
            icon: 'bike',
            label: 'Delivery partners',
            value: n.delivery,
            link: '/admin/delivery-partner-accounts',
          },
          { icon: 'shield-user', label: 'Administrators', value: n.admin, link: '/admin/admins' },
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
