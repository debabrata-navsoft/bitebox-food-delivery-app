import { formatDate } from '@angular/common';
import { Signal, computed, inject, LOCALE_ID } from '@angular/core';
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
import { AnyListTab, ListTab } from '../../shared/components/record-table/record-table';
import { AuthService } from '../../core/auth/auth.service';
import { discountLabel } from '../../shared/coupons/coupon-labels';
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
} from '../../shared/models/admin-roles.models';
import {
  AdminCoupon,
  COUPON_KIND_LABEL,
  COUPON_STATUS_LABEL,
  ORDER_STATUS_LABEL,
  Order,
} from '../../shared/models/checkout.models';
import { AdminPayment, PAYMENT_STATUS_LABEL, PROVIDER_LABEL, paymentTone } from '../../shared/models/payment.models';
import { AdminOrderReviews } from '../../shared/models/review.models';
import { AdminCoinTransaction, SOURCE_LABEL, TXN_TYPE_LABEL } from '../../shared/models/rewards.models';
import { formatPaise } from '../../shared/pipes/money.pipes';
import { openAdminOrder } from './orders/admin-order-dialog/admin-order-dialog';
import { changeLines } from './audit-log/audit-log';
import { openTransaction } from './finance/transaction-dialog/transaction-dialog';
import { BbDialog } from '../../shared/dialog/bb-dialog';

const tone = (t: string) => `tone-${t}`;
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
  const locale = inject(LOCALE_ID);
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, 'd MMM y, h:mm a', locale) : '—');
  const day = (iso: string | null | undefined) => (iso ? formatDate(iso, 'd MMM y', locale) : '—');
  const router = inject(Router);
  const dialog = inject(BbDialog);
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
    orders: (by: 'customer' | 'restaurant' | 'rider', id: Id, onChange?: () => void): ListTab<Order> => ({
      id: 'orders',
      label: by === 'rider' ? 'Deliveries' : 'Orders',
      needs: 'orders:view',
      empty: 'No orders yet.',
      fetch: (page, limit) => orders.list({ [by]: id(), page, limit }),
      open: (o) => openAdminOrder(dialog, o.id).subscribe(() => onChange?.()),
      columns: [
        {
          label: 'Order',
          text: (o) => o.orderNumber,
          sub: (o) => (by === 'restaurant' ? null : o.restaurantSnapshot.name),
        },
        { label: 'Placed', text: (o) => when(o.createdAt) },
        {
          label: 'Status',
          badge: (o) => ({
            label: ORDER_STATUS_LABEL[o.status],
            tone: o.status === 'delivered' ? tone('good') : FAILED.has(o.status) ? tone('bad') : tone('info'),
          }),
        },
        { label: 'Total', num: true, text: (o) => formatPaise(o.pricing.totalPaise) },
      ],
    }),

    payments: (customer: Id): ListTab<AdminPayment> => ({
      id: 'payments',
      label: 'Payments',
      needs: 'finance:view',
      empty: 'No payments yet.',
      fetch: (page, limit) => payments.payments({ customer: customer(), page, limit }),
      // The same payment details as Finance → Transactions.
      open: (p) => openTransaction(dialog, p.id).subscribe(),
      columns: [
        { label: 'Order', text: (p) => p.order?.orderNumber, sub: (p) => when(p.createdAt) },
        { label: 'Method', text: (p) => (p.method === 'cod' ? 'Cash' : 'Online'), sub: (p) => PROVIDER_LABEL[p.provider] },
        { label: 'Status', badge: (p) => ({ label: PAYMENT_STATUS_LABEL[p.status], tone: paymentTone(p.status) }) },
        { label: 'Amount', num: true, text: (p) => formatPaise(p.amountPaise) },
        { label: 'Refunded', num: true, text: (p) => (p.refundedPaise ? formatPaise(p.refundedPaise) : '—') },
      ],
    }),

    coins: (userId: Id): ListTab<AdminCoinTransaction> => ({
      id: 'coins',
      label: 'Coins',
      needs: 'rewards:view',
      empty: 'No coin activity yet.',
      fetch: (page, limit) => rewards.transactions({ userId: userId(), page, limit }),
      columns: [
        { label: 'When', text: (t) => when(t.createdAt) },
        { label: 'Activity', text: (t) => TXN_TYPE_LABEL[t.type], sub: (t) => SOURCE_LABEL[t.source] },
        { label: 'Details', text: (t) => t.description ?? t.note },
        { label: 'Coins', num: true, text: (t) => (t.availableChange > 0 ? '+' : '') + t.availableChange },
        { label: 'Balance', num: true, text: (t) => t.availableAfter },
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
          text: (r) => r.orderNumber,
          sub: (r) => (by === 'customer' ? r.restaurant?.name : r.customerName),
        },
        { label: 'Ratings', text: (r) => r.reviews.map((v) => `${v.rating}★ ${v.target}`).join(' · ') },
        { label: 'Comment', text: (r) => r.reviews.find((v) => v.comment)?.comment },
        { label: 'Reports', num: true, text: (r) => r.openReports || '—' },
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
        { label: 'Ticket', text: (t) => t.number, sub: (t) => t.subject },
        { label: 'Type', text: (t) => TICKET_TYPE_LABEL[t.type], sub: (t) => t.orderNumber },
        { label: 'Status', badge: (t) => ({ label: TICKET_STATUS_LABEL[t.status], tone: tone(TICKET_STATUS_TONE[t.status]) }) },
        { label: 'Priority', text: (t) => TICKET_PRIORITY_LABEL[t.priority] },
        { label: 'Last activity', text: (t) => when(t.lastActivityAt) },
      ],
    }),

    /** A person's sign-ins. */
    activity: (userId: Id): ListTab<LoginEntry> => ({
      id: 'activity',
      label: 'Account activity',
      empty: 'No sign-ins yet.',
      fetch: (page, limit) => users.logins(userId(), page, limit),
      columns: [
        { label: 'Signed in', text: (l) => when(l.signedInAt) },
        { label: 'Last active', text: (l) => when(l.lastActiveAt) },
        { label: 'Device', text: (l) => l.userAgent.slice(0, 60), sub: (l) => l.ip },
        { label: 'Session', badge: (l) => (l.active ? { label: 'Active', tone: tone('good') } : { label: l.endedReason ?? 'Ended' }) },
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
        { label: 'When', text: (e) => when(e.createdAt) },
        { label: 'Admin', text: (e) => e.admin?.name ?? 'Removed admin', sub: (e) => e.adminRole },
        { label: 'What', text: (e) => e.description, sub: (e) => (e.reason ? `Reason: ${e.reason}` : null) },
        { label: 'Changes', text: (e) => changeLines(e).join(' · ') || '—' },
      ],
    }),

    /** When a rider went online or offline, and why. */
    availability: (rider: Id): ListTab<AvailabilityChange> => ({
      id: 'availability',
      label: 'Availability',
      empty: 'No availability changes yet.',
      fetch: (page, limit) => riders.availability(rider(), page, limit),
      columns: [
        { label: 'When', text: (a) => when(a.at) },
        { label: 'Change', badge: (a) => (a.isOnline ? { label: 'Went online', tone: tone('good') } : { label: 'Went offline' }) },
        { label: 'By', text: (a) => SOURCE_TEXT[a.source] },
        { label: 'Reason', text: (a) => a.reason },
      ],
    }),

    menu: (restaurant: Id): ListTab<AdminFoodItem> => ({
      id: 'menu',
      label: 'Menu',
      needs: 'restaurants:manage',
      empty: 'No dishes on the menu.',
      fetch: (page, limit) => catalog.foods({ restaurant: restaurant(), page, limit }),
      columns: [
        { label: 'Dish', text: (f) => f.name, sub: (f) => f.category?.name },
        { label: 'Type', text: (f) => (f.isVeg ? 'Veg' : 'Non-veg') },
        {
          label: 'Available',
          badge: (f) => (f.isAvailable ? { label: 'Available', tone: tone('good') } : { label: 'Unavailable' }),
        },
        { label: 'Price', num: true, text: (f) => formatPaise(f.pricePaise) },
      ],
    }),

    offers: (restaurant: Id): ListTab<AdminCoupon> => ({
      id: 'offers',
      label: 'Offers',
      needs: 'catalog:manage',
      empty: 'No offers or coupons for this restaurant.',
      fetch: (page, limit) => coupons.list({ restaurant: restaurant(), page, limit }),
      columns: [
        { label: 'Offer', text: (c) => c.name || c.code, sub: (c) => COUPON_KIND_LABEL[c.kind ?? 'coupon'] },
        { label: 'Discount', text: (c) => discountLabel(c) },
        { label: 'Valid', text: (c) => `${day(c.validFrom)} – ${day(c.validUntil)}` },
        { label: 'Status', badge: (c) => ({ label: COUPON_STATUS_LABEL[c.status] }) },
        { label: 'Used', num: true, text: (c) => c.usedCount },
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
        { label: 'Created', text: (p) => day(p.createdAt), sub: (p) => (p.periodFrom ? `${day(p.periodFrom)} – ${day(p.periodTo)}` : null) },
        { label: 'Orders', num: true, text: (p) => p.orders },
        { label: 'Status', badge: (p) => ({ label: PAYOUT_STATUS_LABEL[p.status], tone: tone(PAYOUT_STATUS_TONE[p.status]) }) },
        { label: 'Amount', num: true, text: (p) => formatPaise(p.amountPaise), sub: (p) => p.reference },
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
