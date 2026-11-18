import { ListHandle, listPage, page, settle, verifyHttp } from '../../../../shared/list/list-page.testing';
import { RefundsPage } from './refunds';

describe('RefundsPage', () => {
  afterEach(verifyHttp);

  it("sends the panel's filters (lists comma-separated, days as dates) and offers to clear them", async () => {
    const { fixture, http, applyFilters, text } = await listPage(RefundsPage, '/admin/finance/refunds');
    await settle();
    for (const req of http.match((r) => r.url.endsWith('/admin/finance/refunds'))) req.flush(page());

    const cmp = fixture.componentInstance as unknown as { refunds: ListHandle };
    const req = await applyFilters(cmp.refunds, {
      state: ['needed', 'refunded'],
      restaurant: ['r1'],
      updatedTo: new Date(2026, 10, 3),
    });
    const p = req.request.params;
    expect(p.get('state')).toBe('needed,refunded');
    expect(p.get('restaurant')).toBe('r1');
    expect(p.get('updatedTo')).toBe('2026-11-03');
    expect(p.has('updatedFrom')).toBe(false);
    req.flush(page());
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain('Clear filters');
  });
});
