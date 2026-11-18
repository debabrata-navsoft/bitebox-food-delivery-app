import { ListHandle, listPage, page, settle, verifyHttp } from '../../../../shared/list/list-page.testing';
import { CoinTransactionsPage } from './coin-transactions';

const txn = {
  id: 't1',
  type: 'CREDIT',
  source: 'FESTIVAL_REWARD',
  description: 'Lantern Night reward',
  availableChange: 40,
  reservedChange: 0,
  balanceAfter: 40,
  createdAt: '2026-10-01T04:30:00Z',
  customer: { id: 'u1', name: 'Asha Fictional', email: 'asha@example.test' },
};

describe('CoinTransactionsPage', () => {
  afterEach(verifyHttp);

  it("keeps the customer from the link and sends the panel's filters", async () => {
    const path = '/admin/rewards/transactions';
    const { fixture, http, applyFilters, text } = await listPage(CoinTransactionsPage, path, {
      inputs: { userId: 'u1' },
    });
    await settle();
    const first = http.match((r) => r.url.endsWith(path));
    expect(first.at(-1)!.request.params.get('userId')).toBe('u1');
    for (const req of first) req.flush(page([txn]));
    await fixture.whenStable();
    expect(text()).toContain('Showing one customer');

    const cmp = fixture.componentInstance as unknown as { transactions: ListHandle };
    const req = await applyFilters(cmp.transactions, {
      type: ['CREDIT', 'REVERSAL'],
      source: ['FESTIVAL_REWARD'],
      campaign: ['c1', 'c2'],
      from: new Date(2026, 9, 1),
    });
    const p = req.request.params;
    expect(p.get('type')).toBe('CREDIT,REVERSAL');
    expect(p.get('source')).toBe('FESTIVAL_REWARD');
    expect(p.get('campaign')).toBe('c1,c2');
    expect(p.get('from')).toBe(new Date(2026, 9, 1).toISOString());
    expect(p.get('userId')).toBe('u1');
    req.flush(page());
  });
});
