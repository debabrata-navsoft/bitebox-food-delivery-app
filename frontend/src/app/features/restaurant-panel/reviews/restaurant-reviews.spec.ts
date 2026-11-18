import { Observable } from 'rxjs';
import { FilterPreview, FilterValue } from '../../../shared/components/filter-panel/filter-panel.models';
import { listPage, page, settle, verifyHttp } from '../../../shared/list/list-page.testing';
import { RestaurantReviews } from './restaurant-reviews';

const summary = {
  success: true,
  message: '',
  data: {
    rating: { average: 4, count: 2, distribution: [0, 0, 0, 1, 1] },
    unanswered: 1,
    foods: [{ id: 'd1', name: 'Paneer Bowl', rating: { average: 4, count: 1, distribution: [0, 0, 0, 1, 0] } }],
  },
};

type Cmp = {
  reviewList: {
    panel: { set(v: FilterValue): void; (): FilterValue };
    preview(draft: FilterValue): Observable<FilterPreview>;
  };
  filterSections(): { key: string }[];
  pickRating(stars: number | null): void;
  pickDish(id: string): void;
};

describe('RestaurantReviews', () => {
  afterEach(verifyHttp);

  async function create() {
    const p = await listPage(RestaurantReviews, '/my/restaurant/reviews/orders');
    p.http.expectOne((r) => r.url.endsWith('/my/restaurant/reviews/summary')).flush(summary);
    return { ...p, cmp: p.fixture.componentInstance as unknown as Cmp };
  }

  it("opens with no filters and sends the panel's filters as comma lists", async () => {
    const { cmp, list, applyFilters } = await create();
    const first = list();
    expect(first.request.params.keys().sort()).toEqual(['limit', 'page', 'sort']);
    expect(first.request.params.get('sort')).toBe('newest');
    first.flush(page());
    expect(cmp.filterSections().map((s) => s.key)).toEqual(['target', 'rating', 'reply', 'photos', 'dish', 'created']);

    const req = await applyFilters(cmp.reviewList, {
      target: ['restaurant', 'food'],
      rating: ['1', '2'],
      reply: ['needed'],
      photos: ['with'],
      dish: ['d1', 'd2'],
      createdFrom: new Date(2026, 10, 1),
    });
    const p = req.request.params;
    expect(p.get('target')).toBe('restaurant,food');
    expect(p.get('rating')).toBe('1,2');
    expect(p.get('reply')).toBe('needed');
    expect(p.get('photos')).toBe('with');
    expect(p.get('dish')).toBe('d1,d2');
    expect(p.get('createdFrom')).toBe('2026-11-01');
    req.flush(page());
  });

  it('asks for the counts of a draft and turns summary clicks into panel filters', async () => {
    const { cmp, fixture, list } = await create();
    list().flush(page());

    let preview: FilterPreview | undefined;
    cmp.reviewList.preview({ reply: ['replied'] }).subscribe((p) => (preview = p));
    const draft = list();
    expect(draft.request.params.get('facets')).toBe('1');
    expect(draft.request.params.get('reply')).toBe('replied');
    const facets = { reply: [{ value: 'needed', count: 1 }, { value: 'replied', count: 2 }] };
    draft.flush(page([], { facets }));
    expect(preview?.facets['reply']).toEqual(facets.reply);

    cmp.pickRating(5);
    expect(cmp.reviewList.panel()).toEqual({ rating: ['5'], target: ['restaurant'] });
    cmp.pickDish('d1');
    expect(cmp.reviewList.panel()).toEqual({ rating: ['5'], target: ['food'], dish: ['d1'] });
    fixture.detectChanges();
    await settle();
    const req = list();
    expect(req.request.params.get('dish')).toBe('d1');
    expect(req.request.params.get('target')).toBe('food');
    req.flush(page());
  });
});
