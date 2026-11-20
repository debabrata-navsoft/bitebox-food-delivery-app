import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminUsersService, CustomerRow } from '../../../core/services/admin/admin-users.service';
import { Permission } from '../../../core/models/user.models';
import { AdminCustomers } from './admin-customers';

const row = (id: string, name: string, extra: Partial<CustomerRow> = {}): CustomerRow => ({
  id,
  name,
  email: `${name.split(' ')[0].toLowerCase()}@example.test`,
  phone: '+919800000001',
  role: 'customer',
  status: 'active',
  emailVerified: true,
  phoneVerified: false,
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-01T10:00:00Z',
  stats: { orders: 3, spentPaise: 84000, lastOrderAt: null },
  ...extra,
});

describe('AdminCustomers', () => {
  const api = { customers: vi.fn(), setStatus: vi.fn() };

  async function create(permissions: Permission[]) {
    await TestBed.configureTestingModule({
      imports: [AdminCustomers],
      providers: [
        provideRouter([]),
        { provide: AdminUsersService, useValue: api },
        { provide: AuthService, useValue: { can: (p: Permission) => permissions.includes(p), user: signal(null) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AdminCustomers);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    api.customers.mockReset().mockReturnValue(
      of({
        items: [row('0000000000000000aabbccdd', 'Asha Verma'), row('0000000000000000eeff0011', 'Ravi Kumar', { status: 'blocked' })],
        pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
      }),
    );
  });

  it('lists customers with their id, totals and status, newest first', async () => {
    const el = await create(['customers:view']);
    expect(api.customers).toHaveBeenCalledWith(expect.objectContaining({ sort: 'newest', page: 1 }));
    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('#AABBCCDD');
    expect(rows[0].textContent).toContain('₹840');
    expect(rows[1].textContent).toContain('Blocked');
  });

  it('offers Edit and Status only with those permissions', async () => {
    let el = await create(['customers:view']);
    expect(el.querySelector('tbody td.actions [title=Edit]')).toBeNull();
    expect(el.querySelector('tbody td.actions [title="Change status"]')).toBeNull();
    TestBed.resetTestingModule();
    el = await create(['customers:view', 'customers:edit', 'customers:status']);
    expect(el.querySelector('tbody td.actions [title=Edit]')).not.toBeNull();
    expect(el.querySelector('tbody td.actions [title="Change status"]')).not.toBeNull();
  });
});
