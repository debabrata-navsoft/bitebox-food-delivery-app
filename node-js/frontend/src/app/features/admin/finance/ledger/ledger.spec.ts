import { ListHandle, listPage, page, verifyHttp } from '../../../../shared/list/list-page.testing';
import { LedgerPage } from './ledger';

const ledger = (items: unknown[] = []) =>
  page(items, {
    days: 30,
    accounts: [{ account: 'customer_payments', balancePaise: 25000, periodPaise: 25000 }],
    balanced: true,
    unbalancedGroups: 0,
  });

describe('LedgerPage', () => {
  afterEach(verifyHttp);

  it("shows the balances and sends the panel's filters as comma lists", async () => {
    const { fixture, list, applyFilters, text } = await listPage(LedgerPage, '/admin/finance/ledger');
    list().flush(
      ledger([
        {
          id: 'e1',
          group: 'g1',
          account: 'customer_payments',
          amountPaise: 25000,
          description: 'Order BB-FICT-000001 delivered',
          orderNumber: 'BB-FICT-000001',
          createdAt: '2026-11-01T10:00:00Z',
        },
      ]),
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain('Customer payments');
    expect(text()).toContain('Order BB-FICT-000001 delivered');

    const cmp = fixture.componentInstance as unknown as { entries: ListHandle };
    const req = await applyFilters(cmp.entries, { account: ['restaurant_payable', 'payouts'], event: ['payout'] });
    expect(req.request.params.get('account')).toBe('restaurant_payable,payouts');
    expect(req.request.params.get('event')).toBe('payout');
    req.flush(ledger());
  });
});
