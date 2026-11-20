import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { KycSummary } from '../../../../core/models/kyc.models';
import { KycService } from '../../../../core/services/kyc.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { KycVerification } from './kyc-verification';

const summary: KycSummary = {
  documents: [],
  allowedKinds: [],
  checklist: [{ kind: 'pan_card', label: 'PAN card', status: null }],
  payoutAccount: null,
  complete: false,
};

describe('KycVerification', () => {
  const notify = { success: vi.fn(), error: vi.fn() };

  async function create(canResubmit: boolean) {
    await TestBed.configureTestingModule({
      imports: [KycVerification],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: KycService, useValue: { summary: () => of(summary) } },
        { provide: NotificationService, useValue: notify },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KycVerification<{ id: string }>);
    const resubmit = vi.fn(() => of({ id: 'fresh' }));
    fixture.componentRef.setInput('detailsTitle', 'Home address');
    fixture.componentRef.setInput('canResubmit', canResubmit);
    fixture.componentRef.setInput('resubmit', resubmit);
    const sent: { id: string }[] = [];
    fixture.componentInstance.resubmitted.subscribe((a) => sent.push(a));
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement, resubmit, sent };
  }

  beforeEach(() => {
    notify.success.mockReset();
    notify.error.mockReset();
  });

  it('shows the details card, bank account and documents, without "Send for review" by default', async () => {
    const { el } = await create(false);
    expect(el.querySelector('#details-title')!.textContent).toContain('Home address');
    expect(el.textContent).toContain('Bank account');
    expect(el.textContent).toContain('PAN card');
    expect(el.textContent).not.toContain('Send for review');
  });

  it('sends the account for review, then emits the updated account', async () => {
    const { fixture, el, resubmit, sent } = await create(true);
    [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Send for review'))!.click();
    await fixture.whenStable();
    expect(resubmit).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([{ id: 'fresh' }]);
    expect(notify.success).toHaveBeenCalledWith('Sent for review. We will let you know soon.');
  });
});
