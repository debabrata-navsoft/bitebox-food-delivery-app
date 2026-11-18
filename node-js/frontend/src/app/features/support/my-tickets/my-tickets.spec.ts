import { signal } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { ListHandle, listPage, page, verifyHttp } from '../../../shared/list/list-page.testing';
import { MyTickets } from './my-tickets';

type Cmp = { ticketList: ListHandle & { filtered(): boolean }; filterSections: { key: string }[] };

describe('MyTickets', () => {
  afterEach(verifyHttp);

  it("opens with every ticket, then sends the panel's filters as comma lists", async () => {
    const { fixture, list, applyFilters } = await listPage(MyTickets, '/support/tickets', {
      providers: [{ provide: AuthService, useValue: { role: signal('restaurant') } }],
    });
    const first = list();
    expect(first.request.params.has('status')).toBe(false);
    first.flush(page());
    const cmp = fixture.componentInstance as unknown as Cmp;
    expect(cmp.filterSections.map((s) => s.key)).toEqual(['status', 'type', 'created']);
    expect(cmp.ticketList.filtered()).toBe(false);

    const req = await applyFilters(cmp.ticketList, {
      status: ['open', 'closed'],
      type: ['payment', 'refund'],
      createdFrom: new Date(2026, 2, 1),
    });
    const p = req.request.params;
    expect(p.get('status')).toBe('open,closed');
    expect(p.get('type')).toBe('payment,refund');
    expect(p.get('createdFrom')).toBe('2026-03-01');
    req.flush(page());
    expect(cmp.ticketList.filtered()).toBe(true);
  });
});
