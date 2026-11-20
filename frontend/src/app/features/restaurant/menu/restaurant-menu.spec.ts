import { ListHandle, listPage, page, verifyHttp } from '../../../shared/list/list-page.testing';
import { RestaurantMenu } from './restaurant-menu';

const dish = {
  id: 'f1',
  name: 'Fictional Paneer Plate',
  isVeg: true,
  isAvailable: true,
  pricePaise: 24000,
  category: { id: 'c1', name: 'Mains', slug: 'mains', icon: 'restaurant' },
};

describe('RestaurantMenu', () => {
  afterEach(verifyHttp);

  async function create(available?: string) {
    const p = await listPage(RestaurantMenu, '/my/restaurant/foods', { inputs: available ? { available } : {} });
    p.http
      .expectOne((r) => r.url.endsWith('/categories'))
      .flush({ success: true, message: '', data: { categories: [{ id: 'c1', name: 'Mains', slug: 'mains' }] } });
    return p;
  }

  it('filters on the server: panel filters as comma lists, no filters preselected', async () => {
    const { fixture, list, applyFilters, text } = await create();
    const first = list();
    expect(first.request.params.keys().sort()).toEqual(['limit', 'page']);
    first.flush(page([dish]));
    await fixture.whenStable();
    expect(text()).toContain('Fictional Paneer Plate');

    const cmp = fixture.componentInstance as unknown as { menu: ListHandle };
    const req = await applyFilters(cmp.menu, {
      category: ['c1', 'c2'],
      type: ['veg', 'non_veg'],
      availability: ['unavailable'],
    });
    expect(req.request.params.get('category')).toBe('c1,c2');
    expect(req.request.params.get('type')).toBe('veg,non_veg');
    expect(req.request.params.get('availability')).toBe('unavailable');
    req.flush(page());
    await fixture.whenStable();
    expect(text()).toContain('No dishes match these filters');
  });

  it("starts with available dishes from the dashboard's link", async () => {
    const { fixture, list } = await create('true');
    const first = list();
    expect(first.request.params.get('availability')).toBe('available');
    first.flush(page([dish]));
    await fixture.whenStable();
  });
});
