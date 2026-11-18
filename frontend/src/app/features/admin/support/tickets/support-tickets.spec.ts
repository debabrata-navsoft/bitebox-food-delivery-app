import { ListHandle, listPage, page, verifyHttp } from '../../../../shared/list/list-page.testing';
import { SupportTickets } from './support-tickets';

const ticket = {
  id: 't1',
  number: 'TK-FICT-0001',
  type: 'refund',
  subject: 'Cold soup, fictional',
  status: 'open',
  priority: 'high',
  requesterRole: 'customer',
  requesterName: 'Tara Fictional',
  orderNumber: null,
  assignee: null,
  messages: 1,
  createdAt: '2026-11-01T10:00:00Z',
  lastActivityAt: '2026-11-01T10:00:00Z',
};

type Cmp = { tickets: ListHandle; filterSections(): { key: string }[] };

describe('SupportTickets', () => {
  afterEach(verifyHttp);

  async function create(view: string) {
    const p = await listPage(SupportTickets, '/admin/support/tickets', { inputs: { view } });
    return { ...p, cmp: p.fixture.componentInstance as unknown as Cmp };
  }

  it("opens on all the view's tickets and sends the panel's filters as comma lists", async () => {
    const { cmp, fixture, list, applyFilters, text } = await create('customer');
    const first = list();
    expect(first.request.params.get('requesterRole')).toBe('customer');
    expect(first.request.params.has('status')).toBe(false); // no filter chosen yet
    first.flush(page([ticket]));
    await fixture.whenStable();
    expect(text()).toContain('Cold soup, fictional');

    // The view fixes who raised the ticket, so the panel doesn't offer it.
    expect(cmp.filterSections().map((s) => s.key)).toEqual(['status', 'priority', 'type', 'assignee', 'created']);
    const req = await applyFilters(cmp.tickets, {
      status: ['resolved', 'closed'],
      priority: ['high', 'urgent'],
      type: ['refund'],
      assignee: ['unassigned', 'u1'],
      createdFrom: new Date(2026, 10, 1),
    });
    const p = req.request.params;
    expect(p.get('requesterRole')).toBe('customer');
    expect(p.get('status')).toBe('resolved,closed');
    expect(p.get('priority')).toBe('high,urgent');
    expect(p.get('type')).toBe('refund');
    expect(p.get('assignee')).toBe('unassigned,u1');
    expect(p.get('createdFrom')).toBe('2026-11-01');
    expect(p.has('createdTo')).toBe(false);
    req.flush(page());
  });

  it('leaves out the sections a view fixes', async () => {
    const { cmp, list } = await create('refunds');
    const first = list();
    expect(first.request.params.get('type')).toBe('refund');
    first.flush(page());
    expect(cmp.filterSections().map((s) => s.key)).toEqual(['status', 'priority', 'requesterRole', 'assignee', 'created']);
  });
});
