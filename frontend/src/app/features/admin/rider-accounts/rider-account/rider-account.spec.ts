import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Type, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { AdminRiderAccountsService, RiderAccount as Account } from '../../../../core/services/admin/admin-rider-accounts.service';
import { Permission, User } from '../../../../shared/models/user.models';
import { RiderAccountEdit } from '../rider-account-edit/rider-account-edit';
import { RiderAccount } from './rider-account';

const user = {
  id: '00000000-0000-4000-8000-0000aabbccdd',
  name: 'Kiran Rao',
  email: 'kiran@example.test',
  phone: '+919000000501',
  role: 'delivery',
  status: 'active',
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '',
} as User;

const account = (extra: Partial<Account['rider']> = {}): Account => ({
  user,
  rider: {
    id: 'p1',
    isOnline: true,
    completedDeliveries: 12,
    vehicleType: 'scooter',
    vehicleNumber: 'KA01AB1234',
    address: { line1: '3 Hill Road', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001' },
    verification: { status: 'pending', reason: null, verifiedAt: null, submitted: true },
    emergencyContact: null,
    zone: 'Indiranagar',
    ...extra,
  },
  stats: { deliveries: 12, cancelled: 1, earningsPaise: 48000, lastDeliveryAt: null, rating: { average: 4.6, count: 9 } },
  kyc: { status: 'pending', missing: [] },
});

describe('RiderAccount', () => {
  const api = { get: vi.fn(), update: vi.fn(), setVerification: vi.fn(), takeOffline: vi.fn(), availability: vi.fn() };

  async function create<T>(component: Type<T>, permissions: Permission[]) {
    await TestBed.configureTestingModule({
      imports: [component],
      providers: [
        provideRouter([{ path: 'admin/delivery-partner-accounts/:id', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AdminRiderAccountsService, useValue: api },
        { provide: AuthService, useValue: { can: (p: Permission) => permissions.includes(p), user: signal(null) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(component);
    fixture.componentRef.setInput('id', user.id);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    api.get.mockReset().mockReturnValue(of(account()));
    api.update.mockReset().mockReturnValue(of(account()));
  });

  it('offers verification only with riders:approve, and taking offline with riders:status', async () => {
    let { el } = await create(RiderAccount, ['riders:view']);
    let actions = el.querySelector('.head .actions')!.textContent!;
    expect(actions).not.toContain('Approve');
    expect(actions).not.toContain('Take offline');
    TestBed.resetTestingModule();
    ({ el } = await create(RiderAccount, ['riders:view', 'riders:approve', 'riders:status']));
    actions = el.querySelector('.head .actions')!.textContent!;
    expect(actions).toContain('Approve');
    expect(actions).toContain('Take offline');
    expect(el.textContent).toContain('Online');
  });

  it('does not offer taking a rider offline while they carry an order', async () => {
    api.get.mockReturnValue(of(account({ activeOrder: 'o1' } as Partial<Account['rider']>)));
    const { el } = await create(RiderAccount, ['riders:view', 'riders:status']);
    expect(el.textContent).toContain('On a delivery');
    expect(el.querySelector('.head .actions')!.textContent).not.toContain('Take offline');
  });

  it('edit sends only what changed, and needs a phone with an emergency contact name', async () => {
    const { fixture, el } = await create(RiderAccountEdit, ['riders:view', 'riders:edit']);
    const type = (label: string, value: string) => {
      const input = [...el.querySelectorAll<HTMLInputElement>('np-text-input input')].find(
        (i) => i.closest('np-text-input')?.querySelector('label')?.textContent?.trim().startsWith(label),
      )!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const save = async () => {
      el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
      await fixture.whenStable();
    };
    type('Delivery zone', 'Koramangala');
    type('Name', 'Asha Rao');
    await save();
    expect(api.update).not.toHaveBeenCalled(); // a contact name without a phone
    type('Name', '');
    await save();
    expect(api.update).toHaveBeenCalledWith(user.id, { zone: 'Koramangala' });
  });
});
