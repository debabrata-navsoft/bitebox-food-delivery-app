import { Signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AdminCatalogService, AdminFoodItem } from '../../core/services/admin/admin-catalog.service';
import { AdminRewardsService } from '../../core/services/admin/admin-rewards.service';
import { AdminStaffService } from '../../core/services/admin/admin-staff.service';
import { AdminUsersService } from '../../core/services/admin/admin-users.service';
import { FinanceService } from '../../core/services/admin/finance.service';
import { AdminRiderAccountsService, AvailabilityChange } from '../../core/services/admin/admin-rider-accounts.service';
import { AdminCouponService } from '../../core/services/checkout-api.service';
import { AdminOrdersService } from '../../core/services/order-management.service';
import { ReportsService } from '../../core/services/reports.service';
import { ReviewService } from '../../core/services/review.service';
import { SupportDeskService } from '../../core/services/support.service';
import { DATE_YEAR_TIME, TableColumn } from '../../shared/components/data-table/data-table';
import { AnyListTab, ListTab } from '../../shared/components/record-table/record-table';
import { AuthService } from '../../core/auth/auth.service';
import { couponColumns, discountLabel } from '../../shared/coupons/coupon-labels';
import {
  AuditEntry,
  LoginEntry,
  PAYOUT_STATUS_LABEL,
  PAYOUT_STATUS_TONE,
  Payout,
  TICKET_PRIORITY_LABEL,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
  TICKET_TYPE_LABEL,
  TicketSummary,
} from '../../core/models/admin-roles.models';
import {
  AdminCoupon,
  COUPON_KIND_LABEL,
  COUPON_STATUS_LABEL,
  ORDER_STATUS_LABEL,
  Order,
} from '../../core/models/checkout.models';
import { AdminPayment, PAYMENT_STATUS_LABEL, PROVIDER_LABEL, paymentTone } from '../../core/models/payment.models';
import { AdminOrderReviews } from '../../core/models/review.models';
import { AdminCoinTransaction, SOURCE_LABEL, TXN_TYPE_LABEL, coinChange } from '../../core/models/rewards.models';
import { dateText } from '../../shared/utils/dates';
import { changeLines } from './audit-log/audit-log';

const FAILED = new Set(['cancelled', 'rejected']);

type Id = () => string;
const SOURCE_TEXT: Record<AvailabilityChange['source'], string> = {
  rider: 'The rider',
  admin: 'An admin',
  system: 'BiteBox (automatic)',
};

/**
 * The record tabs of the Account management profiles (customers, restaurants, riders). Each
 * reuses an area's own admin list with an account filter, so an admin sees a tab only with that
 * area's permission (`needs`; the API checks it too). Call in an injection context; ids are read
 * when a tab loads.
 */
export function accountTabs() {
  const { day, range } = dateText();
  /** A date-and-time column. */
  const when = <T>(label: string, at: (row: T) => string | null | undefined): TableColumn<T> => ({
    label,
    date: at,
    dateFormat: DATE_YEAR_TIME,
  });
  const router = inject(Router);
  const orders = inject(AdminOrdersService);
  const payments = inject(ReportsService);
  const rewards = inject(AdminRewardsService);
  const reviews = inject(ReviewService);
  const support = inject(SupportDeskService);
  const users = inject(AdminUsersService);
  const audit = inject(AdminStaffService);
  const catalog = inject(AdminCatalogService);
  const coupons = inject(AdminCouponService);
  const finance = inject(FinanceService);
  const riders = inject(AdminRiderAccountsService);

  return {
    /** Orders of a customer, a restaurant or a rider; each opens its details. */
    orders: (by: 'customer' | 'restaurant' | 'rider', id: Id): ListTab<Order> => ({
      id: 'orders',
      label: by === 'rider' ? 'Deliveries' : 'Orders',
      needs: 'orders:view',
      empty: 'No orders yet.',
      fetch: (page, limit) => orders.list({ [by]: id(), page, limit }),
      open: (o) => void router.navigate(['/admin/orders', o.id]),
      columns: [
        {
          label: 'Order',
          value: (o) => o.orderNumber,
          sub: (o) => (by === 'restaurant' ? null : o.restaurantSnapshot.name),
        },
        when('Placed', (o) => o.createdAt),
        {
          label: 'Status',
          badge: (o) => ({
            label: ORDER_STATUS_LABEL[o.status],
            tone: o.status === 'delivered' ? 'good' : FAILED.has(o.status) ? 'bad' : 'info',
          }),
        },
        { label: 'Total', paise: (o) => o.pricing.totalPaise },
      ],
    }),

    payments: (customer: Id): ListTab<AdminPayment> => ({
      id: 'payments',
      label: 'Payments',
      needs: 'finance:view',
      empty: 'No payments yet.',
      fetch: (page, limit) => payments.payments({ customer: customer(), page, limit }),
      // Each payment opens its order's page, as on Finance → Transactions.
      open: (p) => p.order && void router.navigate(['/admin/orders', p.order.id]),
      columns: [
        { label: 'Order', value: (p) => p.order?.orderNumber, sub: (p) => day(p.createdAt, DATE_YEAR_TIME) },
        { label: 'Method', value: (p) => (p.method === 'cod' ? 'Cash' : 'Online'), sub: (p) => PROVIDER_LABEL[p.provider] },
        { label: 'Status', badge: (p) => ({ label: PAYMENT_STATUS_LABEL[p.status], tone: paymentTone(p.status) }) },
        { label: 'Amount', paise: (p) => p.amountPaise },
        { label: 'Refunded', paise: (p) => p.refundedPaise || null },
      ],
    }),

    coins: (userId: Id): ListTab<AdminCoinTransaction> => ({
      id: 'coins',
      label: 'Coins',
      needs: 'rewards:view',
      empty: 'No coin activity yet.',
      fetch: (page, limit) => rewards.transactions({ userId: userId(), page, limit }),
      columns: [
        when('When', (t) => t.createdAt),
        { label: 'Activity', value: (t) => TXN_TYPE_LABEL[t.type], sub: (t) => SOURCE_LABEL[t.source] },
        { label: 'Details', value: (t) => t.description ?? t.note },
        { label: 'Coins', align: 'end', value: coinChange },
        { label: 'Balance', align: 'end', value: (t) => t.availableAfter },
      ],
    }),

    /** Reviews a customer wrote, or a restaurant or rider received. */
    reviews: (by: 'customer' | 'restaurantId' | 'rider', id: Id): ListTab<AdminOrderReviews> => ({
      id: 'reviews',
      label: 'Reviews',
      needs: 'reviews:moderate',
      empty: 'No reviews yet.',
      fetch: (page, limit) => reviews.adminOrders({ [by]: id(), page, limit }),
      columns: [
        {
          label: 'Order',
          value: (r) => r.orderNumber,
          sub: (r) => (by === 'customer' ? r.restaurant?.name : r.customerName),
        },
        { label: 'Ratings', value: (r) => r.reviews.map((v) => `${v.rating}★ ${v.target}`).join(' · ') },
        { label: 'Comment', value: (r) => r.reviews.find((v) => v.comment)?.comment },
        { label: 'Reports', align: 'end', value: (r) => r.openReports || null },
      ],
    }),

    /** Complaints and support requests a person raised. */
    support: (requester: Id, label = 'Support'): ListTab<TicketSummary> => ({
      id: 'support',
      label,
      needs: 'support:manage',
      empty: 'No complaints or support requests.',
      fetch: (page, limit) => support.list({ requester: requester(), page, limit }),
      open: (t) => void router.navigate(['/admin/support/ticket', t.id]),
      columns: [
        { label: 'Ticket', value: (t) => t.number, sub: (t) => t.subject },
        { label: 'Type', value: (t) => TICKET_TYPE_LABEL[t.type], sub: (t) => t.orderNumber },
        { label: 'Status', badge: (t) => ({ label: TICKET_STATUS_LABEL[t.status], tone: TICKET_STATUS_TONE[t.status] }) },
        { label: 'Priority', value: (t) => TICKET_PRIORITY_LABEL[t.priority] },
        when('Last activity', (t) => t.lastActivityAt),
      ],
    }),

    /** A person's sign-ins. */
    activity: (userId: Id): ListTab<LoginEntry> => ({
      id: 'activity',
      label: 'Account activity',
      empty: 'No sign-ins yet.',
      fetch: (page, limit) => users.logins(userId(), page, limit),
      columns: [
        when('Signed in', (l) => l.signedInAt),
        when('Last active', (l) => l.lastActiveAt),
        { label: 'Device', value: (l) => l.userAgent.slice(0, 60), sub: (l) => l.ip },
        { label: 'Session', badge: (l) => (l.active ? { label: 'Active', tone: 'good' } : { label: l.endedReason ?? 'Ended' }) },
      ],
    }),

    /** Admin changes to these records (a person, and e.g. their restaurant). */
    audit: (ids: () => string[]): ListTab<AuditEntry> => ({
      id: 'audit',
      label: 'Admin log',
      needs: 'audit:view',
      empty: 'No admin changes to this account.',
      fetch: (page, limit) => audit.auditLog({ resourceId: ids().join(','), page, limit }),
      columns: [
        when('When', (e) => e.createdAt),
        { label: 'Admin', value: (e) => e.admin?.name ?? 'Removed admin', sub: (e) => e.adminRole },
        { label: 'What', value: (e) => e.description, sub: (e) => (e.reason ? `Reason: ${e.reason}` : null) },
        { label: 'Changes', value: (e) => changeLines(e).join(' · ') },
      ],
    }),

    /** When a rider went online or offline, and why. */
    availability: (rider: Id): ListTab<AvailabilityChange> => ({
      id: 'availability',
      label: 'Availability',
      empty: 'No availability changes yet.',
      fetch: (page, limit) => riders.availability(rider(), page, limit),
      columns: [
        when('When', (a) => a.at),
        { label: 'Change', badge: (a) => (a.isOnline ? { label: 'Went online', tone: 'good' } : { label: 'Went offline' }) },
        { label: 'By', value: (a) => SOURCE_TEXT[a.source] },
        { label: 'Reason', value: (a) => a.reason },
      ],
    }),

    menu: (restaurant: Id): ListTab<AdminFoodItem> => ({
      id: 'menu',
      label: 'Menu',
      needs: 'restaurants:manage',
      empty: 'No dishes on the menu.',
      fetch: (page, limit) => catalog.foods({ restaurant: restaurant(), page, limit }),
      columns: [
        { label: 'Dish', value: (f) => f.name, sub: (f) => f.category?.name },
        { label: 'Type', value: (f) => (f.isVeg ? 'Veg' : 'Non-veg') },
        {
          label: 'Available',
          badge: (f) => (f.isAvailable ? { label: 'Available', tone: 'good' } : { label: 'Unavailable' }),
        },
        { label: 'Price', paise: (f) => f.pricePaise },
      ],
    }),

    offers: (restaurant: Id): ListTab<AdminCoupon> => ({
      id: 'offers',
      label: 'Offers',
      needs: 'catalog:manage',
      empty: 'No offers or coupons for this restaurant.',
      fetch: (page, limit) => coupons.list({ restaurant: restaurant(), page, limit }),
      columns: [
        { label: 'Offer', value: (c) => c.name || c.code, sub: (c) => COUPON_KIND_LABEL[c.kind ?? 'coupon'] },
        { label: 'Discount', value: discountLabel },
        couponColumns(range).valid(),
        { label: 'Status', badge: (c) => ({ label: COUPON_STATUS_LABEL[c.status] }) },
        { label: 'Used', align: 'end', value: (c) => c.usedCount },
      ],
    }),

    /** A restaurant's or a rider's payouts. */
    payouts: (type: 'restaurant' | 'rider', id: Id): ListTab<Payout> => ({
      id: 'payouts',
      label: 'Earnings & payouts',
      needs: 'finance:view',
      empty: 'No payouts yet.',
      fetch: (page, limit) => finance.payouts({ type, [type]: id(), page, limit }),
      columns: [
        { label: 'Created', date: (p) => p.createdAt, sub: (p) => range(p.periodFrom, p.periodTo) },
        { label: 'Orders', align: 'end', value: (p) => p.orders },
        { label: 'Status', badge: (p) => ({ label: PAYOUT_STATUS_LABEL[p.status], tone: PAYOUT_STATUS_TONE[p.status] }) },
        { label: 'Amount', paise: (p) => p.amountPaise, sub: (p) => p.reference },
      ],
    }),
  };
}

/**
 * A profile's record tabs: `build` picks them from `accountTabs()`. `strip` lists the ones this
 * admin may see (for bb-tab-strip); `open` holds the active one, or nothing on another tab.
 * Call in an injection context.
 */
export function recordTabs(active: Signal<string>, build: (t: ReturnType<typeof accountTabs>) => AnyListTab[]) {
  const auth = inject(AuthService);
  const tabs = build(accountTabs());
  return {
    strip: computed(() =>
      tabs.filter((t) => !t.needs || auth.can(t.needs)).map((t) => ({ id: t.id, label: t.label, content: '' })),
    ),
    // A list (of at most one) so the table is created afresh for each tab.
    open: computed(() => tabs.filter((t) => t.id === active())),
  };
}
