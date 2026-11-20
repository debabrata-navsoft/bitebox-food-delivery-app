import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { BB_DIALOG_DATA, BbDialogRef } from '../../dialog/bb-dialog';
import { Permission, User } from '../../../core/models/user.models';
import { AccountStatusData, AccountStatusDialog } from './account-status-dialog';

const user = {
  id: 'u1',
  name: 'Asha Verma',
  email: 'asha@example.test',
  role: 'customer',
  status: 'active',
  createdAt: '',
  updatedAt: '',
} as User;

describe('AccountStatusDialog', () => {
  const close = vi.fn();
  const save = vi.fn();

  async function open(permissions: Permission[]) {
    await TestBed.configureTestingModule({
      imports: [AccountStatusDialog],
      providers: [
        { provide: AuthService, useValue: { can: (p: Permission) => permissions.includes(p), user: signal(null) } },
        { provide: BB_DIALOG_DATA, useValue: { user, kind: 'customers', save } satisfies AccountStatusData },
        { provide: BbDialogRef, useValue: { close } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AccountStatusDialog);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    close.mockReset();
    save.mockReset().mockImplementation((status: string) => of({ ...user, status }));
  });

  it('offers only the statuses this admin may set', async () => {
    const { fixture } = await open(['customers:status']);
    const options = (fixture.componentInstance as unknown as { options: { value: string }[] }).options;
    // Active is the current status; suspending or blocking needs accounts:suspend.
    expect(options.map((o) => o.value)).toEqual(['inactive']);
  });

  it('needs a reason for anything but active, then saves it', async () => {
    const { fixture, el } = await open(['customers:status', 'accounts:suspend']);
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await fixture.whenStable();
    expect(save).not.toHaveBeenCalled();

    const reason = el.querySelector<HTMLTextAreaElement>('np-textarea textarea')!;
    reason.value = '  Repeated chargebacks  ';
    reason.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await fixture.whenStable();
    expect(save).toHaveBeenCalledWith('inactive', 'Repeated chargebacks');
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ status: 'inactive' }));
  });
});
