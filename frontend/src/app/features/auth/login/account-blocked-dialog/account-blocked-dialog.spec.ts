import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BbDialog } from '../../../../shared/dialog/bb-dialog';
import { showAccountBlocked } from './account-blocked-dialog';

describe('showAccountBlocked', () => {
  const blocked = new HttpErrorResponse({
    status: 403,
    error: {
      success: false,
      message: 'This account has been suspended. Reason: Repeated late cancellations',
      error: {
        code: 'ACCOUNT_BLOCKED',
        details: [
          { field: 'status', message: 'suspended' },
          { field: 'reason', message: 'Repeated late cancellations' },
        ],
      },
    },
  });

  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));
  afterEach(() =>
    document.querySelectorAll('.cdk-overlay-container').forEach((c) => (c.innerHTML = '')),
  );

  it('opens a dialog with the status and reason that only its buttons close', async () => {
    const dialog = TestBed.inject(BbDialog);
    expect(showAccountBlocked(dialog, blocked)).toBe(true);
    await new Promise((r) => setTimeout(r));
    TestBed.tick();

    const pane = document.querySelector('.bb-dialog-panel')!;
    expect(pane.querySelector('h2')?.textContent).toContain('Account suspended');
    expect(pane.querySelector('.reason')?.textContent).toContain('Repeated late cancellations');

    (document.querySelector('.bb-dialog-backdrop') as HTMLElement).click();
    TestBed.tick();
    expect(document.querySelector('.bb-dialog-panel')).not.toBeNull();
  });

  it('ignores other errors', () => {
    const other = new HttpErrorResponse({ status: 401, error: { message: 'Wrong password' } });
    expect(showAccountBlocked(TestBed.inject(BbDialog), other)).toBe(false);
  });
});
