import { ListHandle, listPage, page, settle, verifyHttp } from '../../../../shared/list/list-page.testing';
import { RewardCampaignsPage } from './reward-campaigns';

const campaign = {
  id: 'c1',
  name: 'Lantern Night',
  type: 'FESTIVAL',
  trigger: 'CLAIM',
  status: 'ACTIVE',
  rewardCoins: 50,
  startAt: '2026-10-01T04:30:00Z',
  endAt: '2026-10-05T12:30:00Z',
  conditions: { customerGroup: 'ALL', restaurants: [] },
  stats: { claims: 3, coins: 150 },
};

describe('RewardCampaignsPage', () => {
  afterEach(verifyHttp);

  it("sends the panel's filters as comma lists and the run dates as days", async () => {
    const path = '/admin/rewards/campaigns';
    const { fixture, http, applyFilters, text } = await listPage(RewardCampaignsPage, path);
    await settle();
    for (const req of http.match((r) => r.url.endsWith(path))) req.flush(page([campaign]));
    await fixture.whenStable();
    expect(text()).toContain('Lantern Night');

    const cmp = fixture.componentInstance as unknown as { campaigns: ListHandle };
    const req = await applyFilters(cmp.campaigns, {
      status: ['ACTIVE', 'PAUSED'],
      type: ['FESTIVAL'],
      trigger: ['ORDER'],
      customerGroup: ['NEW', 'INACTIVE'],
      runsFrom: new Date(2026, 9, 1),
      runsTo: new Date(2026, 9, 31),
    });
    const p = req.request.params;
    expect(p.get('status')).toBe('ACTIVE,PAUSED');
    expect(p.get('type')).toBe('FESTIVAL');
    expect(p.get('trigger')).toBe('ORDER');
    expect(p.get('customerGroup')).toBe('NEW,INACTIVE');
    expect(p.get('runsFrom')).toBe('2026-10-01');
    expect(p.get('runsTo')).toBe('2026-10-31');
    expect(p.get('page')).toBe('1');
    req.flush(page());
    await fixture.whenStable();
    expect(text()).toContain('Clear filters');
  });
});
