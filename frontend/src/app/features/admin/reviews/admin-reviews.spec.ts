import { ListHandle, listPage, page, settle, verifyHttp } from '../../../shared/list/list-page.testing';
import { AdminReviews } from './admin-reviews';

const reviews = (reported = 0) => page([], { counts: { reported } });

type Cmp = { reviewList: ListHandle; filterSections(): { key: string }[]; selectTabId(id: string): void };

describe('AdminReviews', () => {
  afterEach(verifyHttp);

  async function create() {
    const p = await listPage(AdminReviews, '/admin/reviews/orders');
    return { ...p, cmp: p.fixture.componentInstance as unknown as Cmp };
  }

  it("sends the panel's filters as comma lists", async () => {
    const { cmp, list, applyFilters } = await create();
    list().flush(reviews());
    expect(cmp.filterSections().map((s) => s.key)).toEqual(['target', 'status', 'rating', 'restaurant', 'created']);

    const req = await applyFilters(cmp.reviewList, {
      target: ['food', 'rider'],
      status: ['hidden', 'deleted'],
      rating: ['1', '2'],
      restaurant: ['r1', 'r2'],
      createdFrom: new Date(2026, 10, 1),
    });
    const p = req.request.params;
    expect(p.get('target')).toBe('food,rider');
    expect(p.get('status')).toBe('hidden,deleted');
    expect(p.get('rating')).toBe('1,2');
    expect(p.get('restaurant')).toBe('r1,r2');
    expect(p.get('createdFrom')).toBe('2026-11-01');
    expect(p.has('reported')).toBe(false);
    req.flush(reviews());
  });

  it('keeps the reported tab fixed and drops the status filter there', async () => {
    const { cmp, fixture, list } = await create();
    list().flush(reviews());
    cmp.reviewList.panel.set({ status: ['hidden'], rating: ['5'] });
    cmp.selectTabId('reported');
    fixture.detectChanges();
    await settle();
    const req = list();
    const p = req.request.params;
    expect(p.get('reported')).toBe('true');
    expect(p.get('rating')).toBe('5');
    expect(p.has('status')).toBe(false);
    req.flush(reviews(2));
    expect(cmp.filterSections().map((s) => s.key)).toEqual(['target', 'rating', 'restaurant', 'created']);
  });
});
