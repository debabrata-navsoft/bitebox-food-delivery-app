import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { AdminStaffService } from '../../../../core/services/admin/admin-staff.service';
import { BB_DIALOG_DATA, BbDialog, BbDialogRef } from '../../../../shared/dialog/bb-dialog';
import { User } from '../../../../core/models/user.models';
import { changeLines } from '../../audit-log/audit-format';
import { PermissionEditorDialog } from './permission-editor-dialog';

const catalogue = {
  permissions: [
    { key: 'customers:view', label: 'View customers', group: 'Customers' },
    {
      key: 'customers:edit',
      label: 'Edit customers',
      group: 'Customers',
      requires: ['customers:view'],
    },
    { key: 'orders:view', label: 'View orders', group: 'Orders & operations' },
  ],
  presets: [{ key: 'support', label: 'Support', permissions: ['customers:view', 'orders:view'] }],
};

describe('PermissionEditorDialog', () => {
  const api = { permissionCatalogue: vi.fn(() => of(catalogue)), update: vi.fn() };
  const close = vi.fn();

  async function open(user: Partial<User>) {
    await TestBed.configureTestingModule({
      imports: [PermissionEditorDialog],
      providers: [
        { provide: AdminStaffService, useValue: api },
        { provide: AuthService, useValue: { can: () => true, user: signal(null) } },
        // The confirmation is accepted straight away.
        {
          provide: BbDialog,
          useValue: { open: () => ({ closed: of(true) }), result: () => of(true) },
        },
        {
          provide: BB_DIALOG_DATA,
          useValue: {
            id: 'u1',
            name: 'Ivo Lantern',
            role: 'operator',
            permissions: [],
            customPermissions: [],
            ...user,
          },
        },
        { provide: BbDialogRef, useValue: { close } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(PermissionEditorDialog);
    await fixture.whenStable();
    return {
      fixture,
      el: fixture.nativeElement as HTMLElement,
      cmp: fixture.componentInstance as unknown as PermissionEditorDialog & Record<string, any>,
    };
  }

  beforeEach(() => {
    close.mockReset();
    api.update
      .mockReset()
      .mockImplementation((_id: string, body: object) => of({ id: 'u1', ...body }));
  });

  it('applies a ready-made set and saves exactly that list', async () => {
    const { fixture, el, cmp } = await open({});
    expect(el.textContent).toContain('View customers');
    cmp['applyPreset'](['customers:view', 'orders:view']);
    await cmp['save']();
    await fixture.whenStable();
    expect(api.update).toHaveBeenCalledWith('u1', {
      permissions: ['customers:view', 'orders:view'],
    });
    expect(close).toHaveBeenCalled();
  });

  it('ticks what a permission needs, and unticks what needs a removed one', async () => {
    const { fixture, cmp } = await open({});
    cmp['toggle']('customers:edit', true);
    expect([...cmp['selected']()].sort()).toEqual(['customers:edit', 'customers:view']);
    cmp['toggle']('customers:view', false);
    expect([...cmp['selected']()]).toEqual([]);
    cmp['toggle']('customers:edit', true);
    await cmp['save']();
    await fixture.whenStable();
    expect(api.update).toHaveBeenCalledWith('u1', {
      permissions: ['customers:edit', 'customers:view'],
    });
  });

  it('can send a staff admin back to the role preset (null)', async () => {
    const { cmp } = await open({
      role: 'support_admin',
      permissions: ['orders:view'],
      customPermissions: ['orders:view'],
    });
    cmp['resetToRole']();
    await cmp['save']();
    expect(api.update).toHaveBeenCalledWith('u1', { permissions: null });
  });
});

describe('audit changeLines', () => {
  it('shows each change as old → new, with readable names and values', () => {
    expect(
      changeLines({
        changes: {
          status: { from: 'active', to: 'suspended' },
          costForTwoPaise: { from: 30000, to: 120000 },
          isPureVeg: { from: false, to: true },
        },
      } as never),
    ).toEqual(['Status: active → suspended', 'Cost for two: ₹300 → ₹1,200', 'Pure veg: No → Yes']);
  });

  it('shows list changes as what was added and removed', () => {
    expect(
      changeLines({
        changes: { permissions: { from: ['orders:view'], to: ['orders:view', 'refunds:manage'] } },
      } as never),
    ).toEqual(['Permissions: + Refunds · manage']);
  });
});
