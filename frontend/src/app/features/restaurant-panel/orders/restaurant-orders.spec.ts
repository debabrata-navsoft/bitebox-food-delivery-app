import { signal } from '@angular/core';
import { RestaurantOrderBoard } from '../../../core/services/restaurant-order-board';
import { ListHandle, listPage, page, verifyHttp } from '../../../shared/list/list-page.testing';
import { RestaurantOrders } from './restaurant-orders';

const finished = {
  id: 'o1',
  orderNumber: 'BB-FICT-000201',
  status: 'delivered',
  items: [{ foodItem: 'f1', name: 'Fictional Thali', isVeg: true, quantity: 1 }],
  deliveryAddress: { recipientName: 'Asha Fictional', area: 'Lantern Row', city: 'Westford' },
  pricing: { totalPaise: 29250 },
  createdAt: '2026-11-01T10:00:00Z',
};

describe('RestaurantOrders', () => {
  afterEach(verifyHttp);

  it('shows the Filters panel only on the History tab and sends its filters', async () => {
    const board = {
      board: signal({ items: [], counts: {} }),
      error: signal(null),
      noRestaurant: signal(false),
      connect: () => undefined,
      refresh: () => undefined,
      applyChange: () => undefined,
    };
    const path = '/my/restaurant/orders';
    const { fixture, http, list, applyFilters, text } = await listPage(RestaurantOrders, path, {
      providers: [{ provide: RestaurantOrderBoard, useValue: board }],
    });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    // The live stage tabs have no toolbar, and the history waits for its tab.
    expect(el.querySelector('bb-list-toolbar')).toBeNull();
    http.expectNone((r) => r.url.endsWith(path));

    const cmp = fixture.componentInstance as unknown as { selectTab(tab: string): void; history: ListHandle };
    cmp.selectTab('history');
    fixture.detectChanges();
    const first = list();
    expect(first.request.params.get('view')).toBe('history');
    expect(first.request.params.has('status')).toBe(false); // no filters preselected
    first.flush(page([finished]));
    await fixture.whenStable();
    expect(el.querySelector('bb-list-toolbar')).not.toBeNull();
    expect(text()).toContain('BB-FICT-000201');

    const req = await applyFilters(cmp.history, {
      status: ['rejected', 'cancelled'],
      paymentMethod: ['online'],
      placedFrom: new Date(2026, 10, 1),
    });
    const p = req.request.params;
    expect(p.get('view')).toBe('history');
    expect(p.get('status')).toBe('rejected,cancelled');
    expect(p.get('paymentMethod')).toBe('online');
    expect(p.get('placedFrom')).toBe('2026-11-01');
    expect(p.has('placedTo')).toBe(false);
    req.flush(page());
    await fixture.whenStable();
    expect(text()).toContain('No orders match these filters');
  });
});
