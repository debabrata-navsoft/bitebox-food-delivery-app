import { ListHandle, listPage, page, settle, verifyHttp } from '../../../../shared/list/list-page.testing';
import { RewardHistoryPage } from './reward-history';

const claim = {
  id: 'k1',
  rewardType: 'FESTIVAL',
  coins: 50,
  status: 'ISSUED',
  claimedAt: '2026-10-03T06:30:00Z',
  campaign: { id: 'c1', name: 'Lantern Night' },
  customer: { id: 'u1', name: 'Asha Fictional', email: 'asha@example.test' },
};

describe('RewardHistoryPage', () => {
  afterEach(verifyHttp);

  it("sends the search and the panel's filters", async () => {
    const path = '/admin/rewards/claims';
    const { fixture, http, applyFilters, text } = await listPage(RewardHistoryPage, path);
    await settle();
    for (const req of http.match((r) => r.url.endsWith(path))) req.flush(page([claim]));
    await fixture.whenStable();
    expect(text()).toContain('Lantern Night');

    const cmp = fixture.componentInstance as unknown as {
      claims: ListHandle & { toolbar: { search: () => { value: { set(v: string): void } } } };
    };
    cmp.claims.toolbar.search().value.set('asha');
    const req = await applyFilters(cmp.claims, {
      rewardType: ['WELCOME', 'FESTIVAL'],
      status: ['ISSUED'],
      campaign: ['c1'],
      claimedFrom: new Date(2026, 9, 1),
      claimedTo: new Date(2026, 9, 3),
    });
    const p = req.request.params;
    expect(p.get('search')).toBe('asha');
    expect(p.get('rewardType')).toBe('WELCOME,FESTIVAL');
    expect(p.get('status')).toBe('ISSUED');
    expect(p.get('campaign')).toBe('c1');
    expect(p.get('claimedFrom')).toBe('2026-10-01');
    expect(p.get('claimedTo')).toBe('2026-10-03');
    req.flush(page());
  });
});
