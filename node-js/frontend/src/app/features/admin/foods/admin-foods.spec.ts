import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FilterValue } from '../../../shared/components/filter-panel/filter-panel.models';
import { AdminFoods } from './admin-foods';

const page = (items: unknown[] = []) => ({
  success: true,
  message: '',
  data: { items, pagination: { page: 1, limit: 20, total: items.length, totalPages: 1 } },
});

const dish = {
  id: 'f1',
  name: 'Paneer Tikka',
  isVeg: true,
  isAvailable: true,
  pricePaise: 24000,
  restaurant: { id: 'r1', name: 'Saffron Courtyard', slug: 'saffron-courtyard', status: 'approved' },
  category: { id: 'c1', name: 'Starters', slug: 'starters', icon: 'restaurant' },
};

describe('AdminFoods', () => {
  let http: HttpTestingController;

  async function create(restaurant?: string) {
    await TestBed.configureTestingModule({
      imports: [AdminFoods],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AdminFoods);
    if (restaurant) fixture.componentRef.setInput('restaurant', restaurant);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => http.verify());

  it('starts with the restaurant from the link and sends panel filters as comma lists', async () => {
    const fixture = await create('r1');
    const first = http.expectOne((r) => r.url.endsWith('/admin/foods'));
    expect(first.request.params.get('restaurant')).toBe('r1');
    first.flush(page([dish]));
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Paneer Tikka');

    const cmp = fixture.componentInstance as unknown as { foods: { panel: { set(v: FilterValue): void } } };
    cmp.foods.panel.set({ restaurant: ['r1', 'r2'], type: ['veg'], availability: ['available', 'unavailable'] });
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 350)); // filter changes reload after a short pause
    const next = http.expectOne((r) => r.url.endsWith('/admin/foods'));
    expect(next.request.params.get('restaurant')).toBe('r1,r2');
    expect(next.request.params.get('type')).toBe('veg');
    expect(next.request.params.get('availability')).toBe('available,unavailable');
    expect(next.request.params.get('page')).toBe('1');
    next.flush(page());
  });

  it('loads every dish without a link', async () => {
    await create();
    const req = http.expectOne((r) => r.url.endsWith('/admin/foods'));
    expect(req.request.params.has('restaurant')).toBe(false);
    req.flush(page());
  });
});
