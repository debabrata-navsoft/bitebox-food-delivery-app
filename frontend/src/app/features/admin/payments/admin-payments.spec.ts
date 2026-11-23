import { ListHandle, listPage, page, settle, verifyHttp } from '../../../shared/list/list-page.testing';
import { AdminPayments } from './admin-payments';

const payment = {
  id: 'p1',
  method: 'online',
  provider: 'razorpay',
  status: 'paid',
  amountPaise: 29250,
  createdAt: '2026-11-01T10:00:00Z',
  customer: { id: 'u1', name: 'Asha Fictional', email: 'asha@example.test' },
  order: { id: 'o1', orderNumber: 'BB-FICT-000001', status: 'delivered' },
  refundNeeded: false,
  refundablePaise: 29250,
};

describe('AdminPayments', () => {
  afterEach(verifyHttp);

  it("sends the panel's filters as comma lists and the dates as instants", async () => {
    const { fixture, http, applyFilters, text } = await listPage(AdminPayments, '/admin/payments');
    await settle();
    for (const req of http.match((r) => r.url.endsWith('/admin/payments'))) req.flush(page([payment]));
    await fixture.whenStable();
    expect(text()).toContain('BB-FICT-000001');
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(1);

    const cmp = fixture.componentInstance as unknown as { payments: ListHandle };
    const req = await applyFilters(cmp.payments, {
      status: ['paid', 'refunded'],
      method: ['online'],
      provider: ['razorpay', 'mock'],
      orderState: ['cancelled'],
      restaurant: ['r1', 'r2'],
      from: new Date(2026, 10, 1),
    });
    const p = req.request.params;
    expect(p.get('status')).toBe('paid,refunded');
    expect(p.get('method')).toBe('online');
    expect(p.get('provider')).toBe('razorpay,mock');
    expect(p.get('orderState')).toBe('cancelled');
    expect(p.get('restaurant')).toBe('r1,r2');
    expect(p.get('from')).toBe(new Date(2026, 10, 1).toISOString());
    expect(p.has('to')).toBe(false);
    expect(p.get('page')).toBe('1');
    req.flush(page());
  });
});
