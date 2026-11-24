import { pagePermission } from './admin-pages';

describe('pagePermission', () => {
  it('finds the most specific page for a path or router link', () => {
    expect(pagePermission('/admin/finance/payouts/rider')).toBe('payouts:manage');
    expect(pagePermission('/admin/finance/refunds')).toBe('finance:view');
    expect(pagePermission(['/admin/orders', 'o1'])).toBe('orders:view');
    // "restaurants" is not a prefix of "restaurant-accounts".
    expect(pagePermission(['/admin/restaurant-accounts', 'r1'])).toBe('restaurants:view');
    expect(pagePermission('/admin/restaurants/r1')).toBe('restaurants:view');
    expect(pagePermission('/admin')).toBe('admins:manage');
    expect(pagePermission('/admin/profile')).toBeNull();
  });
});
