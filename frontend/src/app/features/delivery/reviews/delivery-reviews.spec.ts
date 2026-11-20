import { FilterValue } from '../../../shared/components/filter-panel/filter-panel.models';
import { listPage, page, settle, verifyHttp } from '../../../shared/list/list-page.testing';
import { DeliveryReviews } from './delivery-reviews';

const ratings = () => page([], { summary: { average: 4.5, count: 2, distribution: [0, 0, 0, 1, 1] } });

type Cmp = {
  ratingList: { panel: { set(v: FilterValue): void; (): FilterValue } };
  filterSections: { key: string }[];
  rating(): number | null;
  pickRating(stars: number | null): void;
};

describe('DeliveryReviews', () => {
  afterEach(verifyHttp);

  async function create() {
    const p = await listPage(DeliveryReviews, '/delivery/reviews');
    return { ...p, cmp: p.fixture.componentInstance as unknown as Cmp };
  }

  it("opens with no filters and sends the panel's filters as comma lists", async () => {
    const { cmp, fixture, list, applyFilters, text } = await create();
    const first = list();
    expect(first.request.params.keys().sort()).toEqual(['limit', 'page', 'sort']);
    first.flush(ratings());
    expect(cmp.filterSections.map((s) => s.key)).toEqual(['rating', 'comment', 'created']);
    await fixture.whenStable();
    expect(text()).toContain('Your rating');

    const req = await applyFilters(cmp.ratingList, {
      rating: ['1', '2'],
      comment: ['with'],
      createdTo: new Date(2026, 10, 3),
    });
    expect(req.request.params.get('rating')).toBe('1,2');
    expect(req.request.params.get('comment')).toBe('with');
    expect(req.request.params.get('createdTo')).toBe('2026-11-03');
    req.flush(ratings());
  });

  it('picks one star rating from the summary, and none again', async () => {
    const { cmp, fixture, list } = await create();
    list().flush(ratings());
    cmp.pickRating(4);
    expect(cmp.rating()).toBe(4);
    expect(cmp.ratingList.panel()).toEqual({ rating: ['4'] });
    fixture.detectChanges();
    await settle();
    const picked = list();
    expect(picked.request.params.get('rating')).toBe('4');
    picked.flush(ratings());

    cmp.pickRating(null);
    expect(cmp.rating()).toBeNull();
    fixture.detectChanges();
    await settle();
    const req = list();
    expect(req.request.params.has('rating')).toBe(false);
    req.flush(ratings());
  });
});
