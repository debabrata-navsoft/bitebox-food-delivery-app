import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import {
  AdminUserDetail as Detail,
  AdminUsersService,
} from '../../../../core/services/admin/admin-users.service';
import { AdminOrdersService } from '../../../../core/services/order-management.service';
import { User } from '../../../../core/models/user.models';
import { AdminUserDetail } from './admin-user-detail';

const user: User = {
  id: 'u1',
  name: 'Asha Verma',
  email: 'asha@example.test',
  phone: '+919800000001',
  role: 'customer',
  status: 'active',
  emailVerified: true,
  phoneVerified: true,
  birthDate: '1995-11-05',
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-01T10:00:00Z',
};

const detail: Detail = {
  user,
  addresses: [
    {
      id: 'a1',
      label: 'home',
      recipientName: 'Asha Verma',
      phone: '+919800000001',
      line1: '4 Lake View Road',
      city: 'Pune',
      state: 'Maharashtra',
      postalCode: '411001',
      location: { type: 'Point', coordinates: [73.85, 18.52] },
      isDefault: true,
    },
  ],
  stats: {
    orders: 3,
    delivered: 2,
    cancelled: 1,
    spentPaise: 84000,
    lastOrderAt: '2026-11-15T12:00:00Z',
  },
  restaurant: null,
};

describe('AdminUserDetail', () => {
  let fixture: ComponentFixture<AdminUserDetail>;
  const api = { get: vi.fn(), update: vi.fn() };
  const orders = { list: vi.fn() };

  async function create(edit: boolean) {
    await TestBed.configureTestingModule({
      imports: [AdminUserDetail],
      providers: [
        provideRouter([{ path: 'admin/users/:id', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AdminUsersService, useValue: api },
        { provide: AdminOrdersService, useValue: orders },
        { provide: AuthService, useValue: { can: () => true, user: signal(null) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminUserDetail);
    fixture.componentRef.setInput('id', 'u1');
    fixture.componentRef.setInput('edit', edit);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    api.get.mockReset().mockReturnValue(of(detail));
    api.update
      .mockReset()
      .mockImplementation((_id: string, patch: Partial<User>) => of({ ...user, ...patch }));
    orders.list
      .mockReset()
      .mockReturnValue(
        of({ items: [], pagination: { page: 1, limit: 5, total: 0, totalPages: 0 }, counts: {} }),
      );
  });

  it('opens a customer on the overview: totals, account help and recent orders', async () => {
    const el = await create(false);
    expect(el.querySelector('h1')?.textContent).toContain('Asha Verma');
    expect(el.querySelectorAll('bb-stat-tile').length).toBe(4);
    expect(el.textContent).toContain('Send password reset link');
    expect(orders.list).toHaveBeenCalledWith({ customer: 'u1', limit: 5 });
    // The admin may see every area here, so every tab is offered.
    for (const tab of [
      'Personal info',
      'Addresses',
      'Orders',
      'Payments',
      'Coins',
      'Reviews',
      'Support',
      'Account activity',
      'Admin log',
    ])
      expect(el.querySelector('np-tabs')?.textContent).toContain(tab);
  });

  it('shows the personal info and addresses on their tabs, read-only', async () => {
    const el = await create(false);
    const select = async (id: string) => {
      (fixture.componentInstance as unknown as { tab: { set(v: string): void } }).tab.set(id);
      await fixture.whenStable();
    };
    await select('profile');
    expect(el.textContent).toContain('asha@example.test');
    expect(el.querySelector('form')).toBeNull();
    await select('addresses');
    expect(el.textContent).toContain('4 Lake View Road');
    expect(el.textContent).not.toContain('Make default');
  });

  it('edits the name and birthday (not email or phone), sending only what changed', async () => {
    const el = await create(true);
    // Email and phone are shown but only the user can change them.
    expect(el.querySelectorAll('form np-text-input, form bb-phone-input').length).toBe(1);
    expect(el.querySelector('form .locked')?.textContent).toContain('asha@example.test');
    const name = el.querySelector<HTMLInputElement>('form np-text-input input')!;
    name.value = 'Asha V. Verma';
    name.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('form button[type=submit]')!.click();
    await fixture.whenStable();
    expect(api.update).toHaveBeenCalledWith('u1', { name: 'Asha V. Verma' });
  });
});
