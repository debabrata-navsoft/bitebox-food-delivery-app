import { ListHandle, listPage, page, verifyHttp } from '../../../../shared/list/list-page.testing';
import { PayoutsPage } from './payouts';

type Cmp = { payouts: ListHandle; filterSections(): { key: string }[] };

describe('PayoutsPage', () => {
  afterEach(verifyHttp);

  async function create(type: 'restaurant' | 'rider') {
    const p = await listPage(PayoutsPage, '/admin/finance/payouts', { inputs: { type } });
    await new Promise((r) => setTimeout(r)); // the "owed now" resource asks once its effect runs
    const due = { success: true, message: '', data: { items: [] } };
    for (const req of p.http.match((r) => r.url.endsWith('/admin/finance/payouts/due')))
      req.flush(due);
    return { ...p, cmp: p.fixture.componentInstance as unknown as Cmp };
  }

  it("keeps the page's type and sends the panel's filters as comma lists", async () => {
    const { cmp, list, applyFilters } = await create('rider');
    const first = list();
    expect(first.request.params.get('type')).toBe('rider');
    first.flush(page());

    expect(cmp.filterSections().map((s) => s.key)).toEqual(['status', 'rider', 'created']);
    const req = await applyFilters(cmp.payouts, {
      status: ['pending', 'paid'],
      rider: ['u1', 'u2'],
      createdFrom: new Date(2026, 10, 1),
    });
    const p = req.request.params;
    expect(p.get('type')).toBe('rider');
    expect(p.get('status')).toBe('pending,paid');
    expect(p.get('rider')).toBe('u1,u2');
    expect(p.get('createdFrom')).toBe('2026-11-01');
    req.flush(page());
  });

  it('offers restaurants on the restaurant page', async () => {
    const { cmp, list } = await create('restaurant');
    list().flush(page());
    expect(cmp.filterSections().map((s) => s.key)).toEqual(['status', 'restaurant', 'created']);
  });
});
