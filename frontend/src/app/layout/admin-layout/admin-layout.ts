import { ChangeDetectionStrategy, Component, Signal, computed, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { AdminReviewCounts } from '../../core/services/admin/admin-review-counts.service';
import {
  AdminRole,
  MEMBER_VIEW_PERMISSION,
  Permission,
  ROLE_META,
} from '../../shared/models/user.models';
import { NavItem, PanelShell } from '../panel-shell/panel-shell';

const PROFILE: NavItem[] = [{ label: 'Profile', icon: 'manage_accounts', link: '/admin/profile' }];

const NAV: Record<AdminRole, NavItem[]> = {
  // The super admin monitors each team's area through its own expandable tree.
  admin: [
    { label: 'Dashboard', icon: 'space_dashboard', link: '/admin', exact: true },
    {
      label: 'Operations',
      icon: 'activity',
      children: [
        { label: 'Overview', icon: 'space_dashboard', link: '/admin/operations', exact: true },
        { label: 'Orders', icon: 'receipt_long', link: '/admin/orders' },
        { label: 'Restaurants', icon: 'storefront', link: '/admin/restaurants' },
        { label: 'Food items', icon: 'ramen_dining', link: '/admin/foods' },
        { label: 'Delivery partners', icon: 'two_wheeler', link: '/admin/delivery-partners' },
        { label: 'Order monitoring', icon: 'monitor', link: '/admin/operations/monitoring' },
        { label: 'Delivery reports', icon: 'insights', link: '/admin/operations/reports' },
        { label: 'Notification log', icon: 'bell', link: '/admin/operations/notifications' },
      ],
    },
    {
      label: 'Finance',
      icon: 'landmark',
      children: [
        { label: 'Overview', icon: 'space_dashboard', link: '/admin/finance', exact: true },
        { label: 'Transactions', icon: 'payments', link: '/admin/payments' },
        {
          label: 'Restaurant payouts',
          icon: 'storefront',
          link: '/admin/finance/payouts/restaurant',
        },
        { label: 'Rider payments', icon: 'two_wheeler', link: '/admin/finance/payouts/rider' },
        { label: 'Refunds', icon: 'undo-2', link: '/admin/finance/refunds' },
        { label: 'Commission', icon: 'percent', link: '/admin/finance/commission' },
        { label: 'Ledger', icon: 'book-open', link: '/admin/finance/ledger' },
        { label: 'Financial reports', icon: 'chart-line', link: '/admin/reports' },
      ],
    },
    {
      label: 'Support',
      icon: 'life-buoy',
      children: [
        { label: 'Overview', icon: 'space_dashboard', link: '/admin/support', exact: true },
        { label: 'All tickets', icon: 'ticket', link: '/admin/support/queue/all' },
        {
          label: 'Customer complaints',
          icon: 'users-round',
          link: '/admin/support/queue/customer',
        },
        {
          label: 'Restaurant complaints',
          icon: 'storefront',
          link: '/admin/support/queue/restaurant',
        },
        { label: 'Rider complaints', icon: 'two_wheeler', link: '/admin/support/queue/delivery' },
        { label: 'Refund requests', icon: 'undo-2', link: '/admin/support/queue/refunds' },
        { label: 'Reviews', icon: 'star', link: '/admin/reviews' },
      ],
    },
    {
      label: 'Coins & rewards',
      icon: 'coins',
      children: [
        { label: 'Overview', icon: 'space_dashboard', link: '/admin/rewards', exact: true },
        { label: 'Settings', icon: 'settings', link: '/admin/rewards/settings' },
        { label: 'Campaigns', icon: 'party-popper', link: '/admin/rewards/campaigns' },
        { label: 'Referrals', icon: 'user-plus', link: '/admin/rewards/referrals' },
        { label: 'Coin transactions', icon: 'coins', link: '/admin/rewards/transactions' },
        { label: 'Reward history', icon: 'gift', link: '/admin/rewards/history' },
      ],
    },
    {
      label: 'Marketing & Catalog',
      icon: 'megaphone',
      children: [
        { label: 'Categories', icon: 'category', link: '/admin/categories' },
        { label: 'Coupons', icon: 'local_offer', link: '/admin/coupons' },
        { label: 'Push promotions', icon: 'megaphone', link: '/admin/promotions' },
      ],
    },
    {
      label: 'Account management',
      icon: 'users',
      children: [
        { label: 'Customers', icon: 'user', link: '/admin/customers' },
        { label: 'Restaurant accounts', icon: 'storefront', link: '/admin/restaurant-accounts' },
        { label: 'Delivery partner accounts', icon: 'two_wheeler', link: '/admin/delivery-partner-accounts' },
        { label: 'Admin & operators', icon: 'user-cog', link: '/admin/admins' },
      ],
    },
    { label: 'Audit log', icon: 'scroll-text', link: '/admin/audit-log' },
    { label: 'Profile', icon: 'manage_accounts', link: '/admin/profile' },
  ],
  operations_admin: [
    { label: 'Dashboard', icon: 'space_dashboard', link: '/admin/operations', exact: true },
    { label: 'Orders management', icon: 'receipt_long', link: '/admin/orders' },
    { label: 'Restaurant management', icon: 'storefront', link: '/admin/restaurants' },
    { label: 'Delivery management', icon: 'two_wheeler', link: '/admin/delivery-partners' },
    { label: 'Order monitoring', icon: 'monitor', link: '/admin/operations/monitoring' },
    { label: 'Reports', icon: 'insights', link: '/admin/operations/reports' },
    { label: 'Notification log', icon: 'bell', link: '/admin/operations/notifications' },
    ...PROFILE,
  ],
  finance_admin: [
    { label: 'Dashboard', icon: 'space_dashboard', link: '/admin/finance', exact: true },
    { label: 'Transactions', icon: 'payments', link: '/admin/payments' },
    { label: 'Restaurant payouts', icon: 'storefront', link: '/admin/finance/payouts/restaurant' },
    {
      label: 'Delivery partner payments',
      icon: 'two_wheeler',
      link: '/admin/finance/payouts/rider',
    },
    { label: 'Refund management', icon: 'undo-2', link: '/admin/finance/refunds' },
    { label: 'Commission management', icon: 'percent', link: '/admin/finance/commission' },
    { label: 'Ledger', icon: 'book-open', link: '/admin/finance/ledger' },
    { label: 'Financial reports', icon: 'insights', link: '/admin/reports' },
    ...PROFILE,
  ],
  // Built from the super admin's menu: the pages this person's permissions open (below).
  operator: [],
  support_admin: [
    { label: 'Dashboard', icon: 'space_dashboard', link: '/admin/support', exact: true },
    { label: 'All support tickets', icon: 'ticket', link: '/admin/support/queue/all' },
    { label: 'Customer complaints', icon: 'users-round', link: '/admin/support/queue/customer' },
    { label: 'Restaurant complaints', icon: 'storefront', link: '/admin/support/queue/restaurant' },
    {
      label: 'Delivery partner complaints',
      icon: 'two_wheeler',
      link: '/admin/support/queue/delivery',
    },
    { label: 'Refund requests', icon: 'undo-2', link: '/admin/support/queue/refunds' },
    { label: 'Reviews', icon: 'star', link: '/admin/reviews' },
    { label: 'Orders', icon: 'receipt_long', link: '/admin/orders' },
    ...PROFILE,
  ],
};

/** The permission each admin page needs (mirrors admin.routes.ts); the most specific path first. */
const PAGE_PERMISSION: [string, Permission][] = [
  ['/admin/finance/payouts', 'payouts:manage'],
  ['/admin/finance', 'finance:view'],
  ['/admin/payments', 'finance:view'],
  ['/admin/reports', 'finance:view'],
  ['/admin/operations', 'operations:view'],
  ['/admin/orders', 'orders:view'],
  ['/admin/customers', 'customers:view'],
  ['/admin/restaurant-accounts', 'restaurants:view'],
  ['/admin/restaurants', 'restaurants:manage'],
  ['/admin/foods', 'restaurants:manage'],
  ['/admin/delivery-partner-accounts', 'riders:view'],
  ['/admin/delivery-partners', 'riders:manage'],
  ['/admin/support', 'support:manage'],
  ['/admin/reviews', 'reviews:moderate'],
  ['/admin/rewards', 'rewards:view'],
  ['/admin/categories', 'catalog:manage'],
  ['/admin/coupons', 'catalog:manage'],
  ['/admin/promotions', 'promotions:send'],
  ['/admin/admins', 'admins:manage'],
  ['/admin/audit-log', 'audit:view'],
];

const permissionFor = ({ link, query }: NavItem): Permission | null => {
  if (link === '/admin') return 'admins:manage';
  if (link === '/admin/users')
    return MEMBER_VIEW_PERMISSION[query?.['role'] as keyof typeof MEMBER_VIEW_PERMISSION];
  return PAGE_PERMISSION.find(([path]) => link?.startsWith(path))?.[1] ?? null;
};

/** The items this person may open; groups left empty are dropped. */
const allowed = (items: NavItem[], can: (p: Permission) => boolean): NavItem[] =>
  items.flatMap((item) => {
    if (!item.children) {
      const needs = permissionFor(item);
      return !needs || can(needs) ? [item] : [];
    }
    const children = allowed(item.children, can);
    return children.length ? [{ ...item, children }] : [];
  });

/** The items with each link's badge (groups included). */
const withBadges = (items: NavItem[], badges: Record<string, Signal<number>>): NavItem[] =>
  items.map((item) => ({
    ...item,
    badge: item.link ? badges[item.link] : undefined,
    children: item.children && withBadges(item.children, badges),
  }));

@Component({
  selector: 'bb-admin-layout',
  imports: [PanelShell],
  templateUrl: './admin-layout.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminLayout {
  private readonly auth = inject(AuthService);
  private readonly role = computed(() => (this.auth.role() ?? 'admin') as AdminRole);
  private readonly reviews = inject(AdminReviewCounts).watch();
  /** Sidebar counts of what waits for review, by page link. */
  private readonly badges: Record<string, Signal<number>> = {
    '/admin/restaurants': this.reviews.pendingRestaurants,
    '/admin/delivery-partners': this.reviews.pendingRiders,
  };
  protected readonly nav = computed(() =>
    withBadges(
      this.role() === 'operator'
        ? allowed(NAV.admin, (p) => this.auth.can(p))
        : (NAV[this.role()] ?? []),
      this.badges,
    ),
  );
  protected readonly label = computed(() =>
    this.role() === 'admin' ? 'Admin' : ROLE_META[this.role()].label.replace(' admin', ''),
  );
}
