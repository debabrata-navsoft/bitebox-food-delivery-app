import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent, IconComponent } from 'nexprime';
import { catchError, of } from 'rxjs';
import { SavedCard } from '../../../core/models/payment.models';
import { NotificationService } from '../../../core/services/notification.service';
import { PaymentService } from '../../../core/services/payment.service';
import { confirmed } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { errorMessage } from '../../../shared/utils/api-error';
import { acceptedOptions, cardBrand } from '../../../shared/utils/payment-options';

/**
 * The customer's payment methods: cards the gateway saved for them (removable) and the ways
 * BiteBox accepts. Cards are saved at checkout; BiteBox never sees the card number.
 */
@Component({
  selector: 'bb-payment-methods',
  imports: [ButtonComponent, IconComponent, PageHeader],
  templateUrl: './payment-methods.html',
  styleUrl: './payment-methods.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentMethods {
  private readonly payments = inject(PaymentService);
  private readonly notify = inject(NotificationService);
  private readonly dialog = inject(BbDialog);

  protected readonly saved = rxResource({ stream: () => this.payments.cards() });
  protected readonly data = computed(() => (this.saved.hasValue() ? this.saved.value() : null));
  protected readonly loadError = computed(() =>
    this.saved.error() ? errorMessage(this.saved.error(), 'Could not load your cards.') : null,
  );
  protected readonly removing = signal<string | null>(null);

  /** The ways to pay that checkout really offers (online only with a live gateway). */
  private readonly methods = toSignal(this.payments.methods$.pipe(catchError(() => of([]))), {
    initialValue: [],
  });
  protected readonly ways = computed(() => acceptedOptions(this.methods()));

  protected readonly brand = cardBrand;

  /** "HDFC Bank · credit card". */
  protected meta(c: SavedCard): string {
    return [c.issuer, c.cardType && `${c.cardType} card`].filter(Boolean).join(' · ');
  }

  protected expiry(c: SavedCard): string | null {
    return c.expiryMonth && c.expiryYear
      ? `${String(c.expiryMonth).padStart(2, '0')}/${String(c.expiryYear).slice(-2)}`
      : null;
  }

  protected expired(c: SavedCard): boolean {
    if (!c.expiryMonth || !c.expiryYear) return false;
    const now = new Date();
    return c.expiryYear * 12 + c.expiryMonth < now.getFullYear() * 12 + now.getMonth() + 1;
  }

  protected remove(c: SavedCard): void {
    confirmed(this.dialog, {
      title: 'Remove this card?',
      message: `${c.network ?? 'Card'} ending ${c.last4} will no longer be offered at checkout.`,
      confirmLabel: 'Remove',
      danger: true,
    }).subscribe(() => {
      this.removing.set(c.id);
      this.payments.removeCard(c.id).subscribe({
        next: () => {
          this.removing.set(null);
          this.notify.success('Card removed');
          this.saved.reload();
        },
        error: (err: unknown) => {
          this.removing.set(null);
          this.notify.error(errorMessage(err, 'Could not remove the card.'));
        },
      });
    });
  }
}
