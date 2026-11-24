import { Permission } from '../models/user.models';

/** The permission each admin page needs (mirrors admin.routes.ts); the most specific path first. */
export const PAGE_PERMISSION: [string, Permission][] = [
  ['/admin/finance/payouts', 'payouts:manage'],
  ['/admin/finance', 'finance:view'],
  ['/admin/payments', 'finance:view'],
  ['/admin/reports', 'finance:view'],
  ['/admin/operations/dispatch', 'riders:manage'],
  ['/admin/operations', 'operations:view'],
  ['/admin/orders', 'orders:view'],
  ['/admin/customers', 'customers:view'],
  ['/admin/restaurant-accounts', 'restaurants:view'],
  ['/admin/restaurants', 'restaurants:view'],
  ['/admin/foods', 'restaurants:view'],
  ['/admin/delivery-partner-accounts', 'riders:view'],
  ['/admin/delivery-partners', 'riders:view'],
  ['/admin/support', 'support:manage'],
  ['/admin/reviews', 'reviews:moderate'],
  ['/admin/rewards', 'rewards:view'],
  ['/admin/categories', 'catalog:manage'],
  ['/admin/coupons', 'catalog:manage'],
  ['/admin/promotions', 'promotions:send'],
  ['/admin/admins', 'admins:manage'],
  ['/admin/audit-log', 'audit:view'],
];

/** The permission an admin page needs (null: none beyond being an admin), from its path or link. */
export function pagePermission(link: string | readonly unknown[]): Permission | null {
  const path = typeof link === 'string' ? link : link.join('/').replace(/\/+/g, '/');
  if (path === '/admin') return 'admins:manage';
  return (
    PAGE_PERMISSION.find(([page]) => path === page || path.startsWith(page + '/'))?.[1] ?? null
  );
}
