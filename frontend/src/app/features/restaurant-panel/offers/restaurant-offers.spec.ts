import { ListHandle, listPage, page, verifyHttp } from '../../../shared/list/list-page.testing';
import { RestaurantOffers } from './restaurant-offers';

describe('RestaurantOffers', () => {
  afterEach(verifyHttp);

  it("sends the panel's filters as comma lists and the dates as instants", async () => {
    const { fixture, http, list, applyFilters, text } = await listPage(RestaurantOffers, '/my/restaurant/offers');
    http.expectOne((r) => r.url.endsWith('/my/restaurant/offers/analytics')).flush({ success: false });
    const first = list();
    expect(first.request.params.keys().sort()).toEqual(['limit', 'page']); // no filters preselected
    first.flush(page());
    await fixture.whenStable();
    expect(text()).toContain('No offers yet');

    const cmp = fixture.componentInstance as unknown as { offers: ListHandle };
    const req = await applyFilters(cmp.offers, {
      status: ['active', 'pending'],
      discountType: ['flat'],
      from: new Date(2026, 10, 1),
    });
    const p = req.request.params;
    expect(p.get('status')).toBe('active,pending');
    expect(p.get('discountType')).toBe('flat');
    expect(p.get('from')).toBe(new Date(2026, 10, 1).toISOString());
    expect(p.has('to')).toBe(false);
    req.flush(page());
    await fixture.whenStable();
    expect(text()).toContain('No offers match these filters');
  });
});
