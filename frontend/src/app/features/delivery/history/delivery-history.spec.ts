import { ListHandle, listPage, page, verifyHttp } from '../../../shared/list/list-page.testing';
import { DeliveryHistory } from './delivery-history';

const delivery = {
  id: 'o1',
  orderNumber: 'BB-FICT-000101',
  status: 'delivered',
  restaurant: 'r1',
  restaurantSnapshot: { name: 'Fictional Spoon' },
  deliveryAddress: { area: 'Lantern Row', city: 'Westford' },
  pricing: { totalPaise: 29250 },
  updatedAt: '2026-11-01T10:00:00Z',
  estimatedEarningsPaise: 4500,
};

describe('DeliveryHistory', () => {
  afterEach(verifyHttp);

  it("sends the panel's filters as comma lists and the dates as days", async () => {
    const { fixture, list, applyFilters, text } = await listPage(DeliveryHistory, '/delivery/orders/history');
    const first = list();
    expect(first.request.params.keys().sort()).toEqual(['limit', 'page']); // no filters preselected
    first.flush(page([delivery]));
    await fixture.whenStable();
    expect(text()).toContain('BB-FICT-000101');
    expect((fixture.nativeElement as HTMLElement).querySelector('bb-list-toolbar')).not.toBeNull();

    const cmp = fixture.componentInstance as unknown as { history: ListHandle };
    const req = await applyFilters(cmp.history, {
      status: ['delivered', 'cancelled'],
      restaurant: ['r1', 'r2'],
      placedFrom: new Date(2026, 10, 1),
      placedTo: new Date(2026, 10, 3),
    });
    const p = req.request.params;
    expect(p.get('status')).toBe('delivered,cancelled');
    expect(p.get('restaurant')).toBe('r1,r2');
    expect(p.get('placedFrom')).toBe('2026-11-01');
    expect(p.get('placedTo')).toBe('2026-11-03');
    expect(p.get('page')).toBe('1');
    req.flush(page());
    await fixture.whenStable();
    expect(text()).toContain('No deliveries match these filters');
  });
});
