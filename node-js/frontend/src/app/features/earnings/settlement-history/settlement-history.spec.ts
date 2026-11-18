import { ListHandle, listPage, page, verifyHttp } from '../../../shared/list/list-page.testing';
import { SettlementHistory } from './settlement-history';

type Cmp = {
  settlementList: ListHandle;
  payoutList: ListHandle;
  settlementSections: { key: string }[];
  payoutSections: { key: string }[];
  select(value: unknown): void;
};

describe('SettlementHistory (earnings page lists)', () => {
  afterEach(verifyHttp);

  async function create(scope: 'restaurant' | 'rider', path: string) {
    const p = await listPage(SettlementHistory, path, { inputs: { scope } });
    return { ...p, cmp: p.fixture.componentInstance as unknown as Cmp };
  }

  it("filters the partner's settlements with the panel (no filters at first)", async () => {
    const { cmp, list, applyFilters } = await create('rider', '/delivery/settlements');
    const first = list();
    expect(first.request.params.keys().sort()).toEqual(['limit', 'page']);
    first.flush(page());
    expect(cmp.settlementSections.map((s) => s.key)).toEqual(['status', 'settled']);

    const req = await applyFilters(cmp.settlementList, {
      status: ['due', 'pending'],
      settledFrom: new Date(2026, 4, 1),
    });
    expect(req.request.params.get('status')).toBe('due,pending');
    expect(req.request.params.get('settledFrom')).toBe('2026-05-01');
    req.flush(page());
  });

  it('loads the payouts when asked, and filters them by status', async () => {
    const { cmp, http, applyFilters } = await create('restaurant', '/my/restaurant/payouts');
    http.expectOne((r) => r.url.endsWith('/my/restaurant/settlements')).flush(page());
    cmp.select('payouts');
    http.expectOne((r) => r.url.endsWith('/my/restaurant/payouts')).flush(page());
    expect(cmp.payoutSections.map((s) => s.key)).toEqual(['status', 'created']);

    const req = await applyFilters(cmp.payoutList, { status: ['paid', 'cancelled'] });
    expect(req.request.params.get('status')).toBe('paid,cancelled');
    req.flush(page());
  });
});
