import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { SavedCards } from '../../../core/models/payment.models';
import { NotificationService } from '../../../core/services/notification.service';
import { PaymentService } from '../../../core/services/payment.service';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { PaymentMethods } from './payment-methods';

const visa = {
  id: 'c1',
  network: 'Visa',
  last4: '4242',
  issuer: 'Test Bank',
  cardType: 'credit',
  expiryMonth: 8,
  expiryYear: 2099,
  createdAt: '2026-11-01T00:00:00Z',
};

describe('PaymentMethods', () => {
  async function open(saved: SavedCards) {
    const payments = {
      cards: vi.fn(() => of(saved)),
      removeCard: vi.fn(() => of({})),
      methods$: of([
        { method: 'cod', label: 'Cash', provider: 'cash_on_delivery', simulated: false },
        { method: 'online', label: 'Online', provider: 'razorpay', simulated: false },
      ]),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: PaymentService, useValue: payments },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn() } },
        // Confirms every question.
        { provide: BbDialog, useValue: { open: () => ({ closed: of(true) }) } },
      ],
    });
    const fixture = TestBed.createComponent(PaymentMethods);
    await fixture.whenStable();
    return { fixture, payments, el: fixture.nativeElement as HTMLElement };
  }

  it('lists saved cards by network and last 4 digits, and removes one after asking', async () => {
    const { fixture, payments, el } = await open({
      cards: [visa],
      canSave: true,
      simulated: false,
    });
    const card = el.querySelector('.card')!.textContent!.replace(/\s+/g, ' ');
    expect(card).toContain('Visa');
    expect(card).toContain('•••• 4242');
    expect(card).toContain('Expires 08/99');
    expect(el.textContent).toContain('Net banking'); // ways to pay
    (fixture.componentInstance as unknown as { remove: (c: typeof visa) => void }).remove(visa);
    await fixture.whenStable();
    expect(payments.removeCard).toHaveBeenCalledWith('c1');
    expect(payments.cards).toHaveBeenCalledTimes(2); // reloaded
  });

  it('explains how to save a card when there are none', async () => {
    const { el } = await open({ cards: [], canSave: true, simulated: false });
    expect(el.textContent).toContain('No saved cards yet');
    expect(el.textContent).toContain('never sees or stores your full card number');
  });
});
