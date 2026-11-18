import { ListHandle, listPage, page, settle, verifyHttp } from '../../../../shared/list/list-page.testing';
import { RewardReferralsPage } from './reward-referrals';

const referral = {
  id: 'r1',
  referrer: { id: 'u1', name: 'Asha Fictional', email: 'asha@example.test' },
  referred: { id: 'u2', name: 'Ravi Imaginary', email: 'ravi@example.test' },
  code: 'ASHA2026',
  status: 'ORDER_DELIVERED',
  qualifyingOrder: null,
  attributionExpiresAt: '2026-12-01T00:00:00Z',
  referrerCoins: 0,
  referredCoins: 0,
  rewardStatus: 'HELD',
  riskFlags: ['SAME_SIGNUP_IP'],
  history: [],
  createdAt: '2026-10-01T04:30:00Z',
};
const path = '/admin/rewards/referrals';
const referrals = (items: unknown[] = [], counts: Record<string, number> = {}) => page(items, { counts });

describe('RewardReferralsPage', () => {
  afterEach(verifyHttp);

  async function setUp() {
    const p = await listPage(RewardReferralsPage, path);
    await settle();
    for (const req of p.http.match((r) => r.url.endsWith(path))) req.flush(referrals([referral], { HELD: 4 }));
    await p.fixture.whenStable();
    return p;
  }

  it("sends the panel's filters as comma lists and shows the held count", async () => {
    const { fixture, applyFilters, text } = await setUp();
    expect(text()).toContain('Ravi Imaginary');
    expect(text()).toContain('4');

    const cmp = fixture.componentInstance as unknown as { referrals: ListHandle };
    const req = await applyFilters(cmp.referrals, {
      status: ['ORDER_DELIVERED', 'REWARD_CREDITED'],
      rewardStatus: ['HELD'],
      risk: ['SAME_SIGNUP_IP', 'REFERRER_VELOCITY'],
      createdFrom: new Date(2026, 9, 1),
    });
    const p = req.request.params;
    expect(p.get('status')).toBe('ORDER_DELIVERED,REWARD_CREDITED');
    expect(p.get('rewardStatus')).toBe('HELD');
    expect(p.get('risk')).toBe('SAME_SIGNUP_IP,REFERRER_VELOCITY');
    expect(p.get('createdFrom')).toBe('2026-10-01');
    expect(p.has('createdTo')).toBe(false);
    req.flush(referrals());
  });

  it('"Held for review" filters the held referrals', async () => {
    const { fixture, list } = await setUp();
    const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Held for review'),
    )!;
    button.click();
    fixture.detectChanges();
    await settle();
    const req = list();
    expect(req.request.params.get('rewardStatus')).toBe('HELD');
    req.flush(referrals());
  });
});
