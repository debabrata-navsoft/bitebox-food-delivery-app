import { ListHandle, listPage, page, verifyHttp } from '../../../shared/list/list-page.testing';
import { AdminCoupons } from './admin-coupons';

const coupon = {
  id: 'c1',
  code: 'MAPLE20',
  name: 'Maple weekend',
  kind: 'coupon',
  discountType: 'percent',
  discountValue: 20,
  minOrderPaise: 0,
  validFrom: '2026-01-01T00:00:00Z',
  validUntil: '2026-12-31T00:00:00Z',
  isActive: true,
  usageLimit: null,
  usedCount: 0,
  perUserLimit: 1,
  restaurant: null,
  source: 'platform',
  status: 'active',
  approvalStatus: 'approved',
  createdAt: '2026-01-01T00:00:00Z',
};

describe('AdminCoupons', () => {
  afterEach(verifyHttp);

  it('sends the sort and the panel filters as comma lists, dates as instants', async () => {
    const { fixture, http, list, applyFilters, text } = await listPage(
      AdminCoupons,
      '/admin/coupons',
    );
    http
      .match((r) => r.url.endsWith('/admin/coupons/analytics'))
      .forEach((r) => r.flush({ success: true, message: '', data: null }));
    const first = list();
    expect(first.request.params.get('sort')).toBe('newest');
    expect(first.request.params.has('status')).toBe(false);
    first.flush(page([coupon]));
    await fixture.whenStable();
    expect(text()).toContain('MAPLE20');

    const cmp = fixture.componentInstance as unknown as { coupons: ListHandle };
    const next = await applyFilters(cmp.coupons, {
      status: ['active', 'paused'],
      kind: ['coupon'],
      owner: ['platform', 'restaurant'],
      audience: ['new'],
      discountType: ['flat', 'free_delivery'],
      restaurant: ['r1', 'r2'],
      from: new Date(2026, 2, 1),
      to: new Date(2026, 2, 31),
    });
    const p = next.request.params;
    expect(p.get('status')).toBe('active,paused');
    expect(p.get('kind')).toBe('coupon');
    expect(p.get('owner')).toBe('platform,restaurant');
    expect(p.get('audience')).toBe('new');
    expect(p.get('discountType')).toBe('flat,free_delivery');
    expect(p.get('restaurant')).toBe('r1,r2');
    expect(p.get('from')).toBe(new Date(2026, 2, 1, 0, 0, 0, 0).toISOString());
    expect(p.get('to')).toBe(new Date(2026, 2, 31, 23, 59, 59, 999).toISOString());
    expect(p.get('page')).toBe('1');
    next.flush(page());
  });
});
