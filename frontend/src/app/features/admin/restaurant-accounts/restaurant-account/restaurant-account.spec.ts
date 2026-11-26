import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import {
  AdminRestaurantAccountsService,
  AdminRestaurantStore,
  RestaurantAccount as Account,
} from '../../../../core/services/admin/admin-restaurant-accounts.service';
import { Restaurant } from '../../../../core/models/catalog.models';
import { Permission, User } from '../../../../core/models/user.models';
import { RestaurantAccount } from './restaurant-account';

const restaurant = {
  id: '00000000-0000-4000-8000-0000aabbccdd',
  name: 'Lotus Bowl',
  slug: 'lotus-bowl',
  cuisines: ['Asian'],
  phone: '+919800000002',
  address: { line1: '9 Lake Road', city: 'Pune', state: 'Maharashtra', postalCode: '411001' },
  location: { type: 'Point', coordinates: [73.85, 18.52] },
  isPureVeg: false,
  costForTwoPaise: 60000,
  minOrderPaise: 0,
  avgPrepTimeMinutes: 20,
  openingTime: '10:00',
  closingTime: '22:00',
  isAcceptingOrders: true,
  isOpenNow: true,
  status: 'pending',
  rating: { average: 0, count: 0 },
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '',
} as unknown as Restaurant;

const owner = {
  id: 'u9',
  name: 'Ravi Kumar',
  email: 'ravi@example.test',
  role: 'restaurant',
  status: 'active',
  createdAt: '',
  updatedAt: '',
} as User;

const account: Account = {
  restaurant,
  owner,
  stats: {
    orders: 4,
    delivered: 3,
    cancelled: 1,
    grossPaise: 150000,
    lastOrderAt: null,
    rating: { average: 0, count: 0 },
  },
  commission: { percent: 18, source: 'default' },
  kyc: { status: 'incomplete', missing: ['fssai'] },
};

describe('RestaurantAccount', () => {
  const api = { get: vi.fn(), setStatus: vi.fn(), setAccepting: vi.fn(), update: vi.fn() };

  async function create(permissions: Permission[]) {
    await TestBed.configureTestingModule({
      imports: [RestaurantAccount],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AdminRestaurantAccountsService, useValue: api },
        {
          provide: AuthService,
          useValue: { can: (p: Permission) => permissions.includes(p), user: signal(null) },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(RestaurantAccount);
    fixture.componentRef.setInput('id', restaurant.id);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => api.get.mockReset().mockReturnValue(of(account)));

  it('offers approval actions only with restaurants:approve', async () => {
    let el = await create(['restaurants:view']);
    expect(el.querySelector('.head .actions')?.textContent).not.toContain('Approve');
    TestBed.resetTestingModule();
    el = await create(['restaurants:view', 'restaurants:approve']);
    const actions = el.querySelector('.head .actions')!.textContent!;
    expect(actions).toContain('Approve');
    expect(actions).toContain('Reject');
  });

  it('shows the KYC state and only the tabs this admin may open', async () => {
    const el = await create(['restaurants:view', 'orders:view']);
    expect(el.textContent).toContain('KYC: Incomplete');
    const tabs = el.querySelector('np-tabs')!.textContent!;
    expect(tabs).toContain('Orders');
    expect(tabs).not.toContain('Earnings');
    expect(tabs).not.toContain('KYC & bank');
  });
});

describe('AdminRestaurantStore', () => {
  it('loads and saves the restaurant in the URL through the admin API', () => {
    const api = { get: vi.fn(() => of(account)), update: vi.fn(() => of(restaurant)) };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        AdminRestaurantStore,
        { provide: AdminRestaurantAccountsService, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: restaurant.id }) } },
        },
      ],
    });
    const store = TestBed.inject(AdminRestaurantStore);
    let loaded: unknown;
    store.get().subscribe((s) => (loaded = s.restaurant));
    expect(loaded).toBe(restaurant);
    store.update({ name: 'Lotus Bowl Kitchen' }).subscribe();
    expect(api.update).toHaveBeenCalledWith(restaurant.id, { name: 'Lotus Bowl Kitchen' });
  });
});
