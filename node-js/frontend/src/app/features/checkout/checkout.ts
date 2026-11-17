import { NpIconPipe } from '../../shared/icons/np-icon-name';
import { IconComponent } from 'nexprime';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { form, maxLength } from '@angular/forms/signals';
import { TitleCasePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, filter, firstValueFrom, of } from 'rxjs';
import { errorCode, errorMessage } from '../../core/services/api-error';
import { ConnectionStatus } from '../../core/services/connection-status.service';
import { CartActions } from '../../core/services/cart-actions.service';
import { newIdempotencyKey } from '../../core/services/idempotency';
import { CartService } from '../../core/services/cart.service';
import { DeliveryLocationService } from '../../core/services/delivery-location.service';
import { AddressService, OrderService } from '../../core/services/checkout-api.service';
import { NotificationService } from '../../core/services/notification.service';
import { PaymentService } from '../../core/services/payment.service';
import { CheckoutSession, PaymentMethod } from '../../shared/models/payment.models';
import { AddressFormDialog } from '../../shared/components/address-form-dialog/address-form-dialog';
import { BillSummary } from '../../shared/components/bill-summary/bill-summary';
import { CheckoutCoins } from './checkout-coins/checkout-coins';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { QtyStepper } from '../../shared/components/qty-stepper/qty-stepper';
import { VegBadge } from '../../shared/components/veg-badge/veg-badge';
import { CouponOffer, DeliveryAddress, PaymentChannel } from '../../shared/models/checkout.models';
import { InrPipe, formatPaise } from '../../shared/pipes/money.pipes';
import { BbDialog } from '../../shared/dialog/bb-dialog';
import { openCoupons } from './coupon-dialog/coupon-dialog';
import { codeApplier } from '../../shared/coupons/cart-offers';


import { NP_FORM_FIELDS } from '../../shared/forms/np-form-fields';

@Component({
  selector: 'bb-checkout',
  imports: [
    NP_FORM_FIELDS,
    RouterLink,
    MatButtonModule,
    IconComponent,
    NpIconPipe,
    MatProgressSpinnerModule,
    MatRadioModule,
    BillSummary,
    CheckoutCoins,
    EmptyState,
    QtyStepper,
    VegBadge,
    InrPipe,
    TitleCasePipe,
  ],
  templateUrl: './checkout.html',
  styleUrl: './checkout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Checkout {
  protected readonly cart = inject(CartService);
  protected readonly connection = inject(ConnectionStatus);
  protected readonly cartActions = inject(CartActions);
  private readonly addresses = inject(AddressService);
  private readonly orders = inject(OrderService);
  private readonly dialog = inject(MatDialog);
  private readonly bbDialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly payments = inject(PaymentService);

  protected readonly quote = this.cart.quote;
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly savedAddresses = signal<DeliveryAddress[]>([]);
  protected readonly offers = signal<CouponOffer[]>([]);
  protected readonly noteForm = form(signal({ note: '' }), (path) => {
    maxLength(path.note, 300, { message: 'Keep the note under 300 characters' });
  });

  private readonly methods = toSignal(this.payments.methods$.pipe(catchError(() => of([]))), {
    initialValue: [],
  });
  protected readonly onlineAvailable = computed(() =>
    this.methods().some((m) => m.method === 'online'),
  );
  /** Cash, or the online channel (UPI, card, ...): the bill is priced with its payment offer. */
  protected readonly payWith = computed(() => this.cart.paymentChannel() ?? 'cod');
  protected readonly paymentMethod = computed<PaymentMethod>(() => (this.payWith() === 'cod' ? 'cod' : 'online'));
  protected readonly channels: { value: PaymentChannel; label: string; icon: string }[] = [
    { value: 'upi', label: 'UPI', icon: 'smartphone' },
    { value: 'card', label: 'Credit or debit card', icon: 'credit-card' },
    { value: 'netbanking', label: 'Net banking', icon: 'landmark' },
    { value: 'wallet', label: 'Wallet', icon: 'wallet' },
  ];

  /** The best payment offer for each channel on this cart (the server's figures). */
  protected readonly paymentOffers = computed(
    () => new Map((this.cart.quote()?.paymentOffers ?? []).map((o) => [o.channel, o])),
  );

  /** Re-prices the cart for the chosen way to pay (a channel's payment offer joins the bill). */
  protected choosePay(value: 'cod' | PaymentChannel): void {
    this.cart.paymentChannel.set(value === 'cod' ? null : value);
    this.cart.refresh().subscribe({ error: (err: unknown) => this.notify.error(errorMessage(err)) });
  }
  protected readonly placing = signal(false);
  protected readonly placeError = signal<string | null>(null);

  private idempotencyKey = newIdempotencyKey();

  protected readonly selectedAddressId = computed(() => this.quote()?.address?.id ?? null);
  protected readonly blockingIssues = computed(() =>
    (this.quote()?.issues ?? []).filter((i) => i.code !== 'NO_ADDRESS'),
  );

  constructor() {
    const location = inject(DeliveryLocationService).location();
    if (location?.source === 'address' && location.addressId && !this.cart.selectedAddressId()) {
      this.cart.selectedAddressId.set(location.addressId);
    }
    this.cart.paymentChannel.set(null); // priced for cash until the customer picks a channel
    this.cart.refresh().subscribe({
      next: (quote) => {
        this.loading.set(false);
        if (quote.cart?.restaurant) this.loadOffers(quote.cart.restaurant.id);
      },
      error: (err: unknown) => {
        this.loadError.set(errorMessage(err, 'Could not load your cart.'));
        this.loading.set(false);
      },
    });
    this.addresses.list().subscribe({ next: (list) => this.savedAddresses.set(list) });
  }

  private loadOffers(restaurantId: string): void {
    this.orders
      .availableCoupons(restaurantId)
      .subscribe({ next: (list) => this.offers.set(list), error: () => this.offers.set([]) });
  }

  /** The one restaurant offer on this cart (the best, or the one the customer picked). */
  protected readonly restaurantOffer = computed(
    () => this.cart.quote()?.restaurantOffers?.find((o) => o.applied) ?? null,
  );

  /** The server's best coupon for this cart, when it saves more than the applied one. */
  protected readonly suggestion = computed(() => {
    const q = this.cart.quote();
    const best = q?.bestCoupon;
    const extra = (best?.savingPaise ?? 0) - (q?.coupon?.discountPaise ?? 0);
    if (!best || best.code === q?.coupon?.code || extra <= 0) return null;
    return { code: best.code, extra, switching: !!q?.coupon };
  });

  /** One tap on the suggested coupon (the server's pick for this cart). */
  private readonly applier = codeApplier();
  protected readonly applyBest = this.applier.apply;

  /** "Apply coupon": every coupon for this cart; the quote refreshes once one is applied. */
  protected showCoupons(): void {
    openCoupons(this.bbDialog, this.offers()).subscribe();
  }


  protected applyCoins(coins: number): void {
    this.cart.setCoins(coins).subscribe({
      next: (quote) => {
        if (quote.coins?.applied)
          this.notify.success(`${quote.coins.applied} coins applied — you save ${formatPaise(quote.coins.discountPaise)}`);
      },
      error: (err: unknown) => this.notify.error(errorMessage(err)),
    });
  }

  protected removeCoins(): void {
    this.cart.removeCoins().subscribe({ error: (err: unknown) => this.notify.error(errorMessage(err)) });
  }

  protected removeCoupon(): void {
    this.cart
      .removeCoupon()
      .subscribe({ error: (err: unknown) => this.notify.error(errorMessage(err)) });
  }

  protected selectAddress(id: string): void {
    this.cart
      .selectAddress(id)
      .subscribe({ error: (err: unknown) => this.notify.error(errorMessage(err)) });
  }

  protected addAddress(): void {
    this.dialog
      .open<AddressFormDialog, DeliveryAddress | null, DeliveryAddress>(AddressFormDialog, {
        data: null,
        width: '640px',
        maxWidth: '95vw',
        autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .pipe(filter((a): a is DeliveryAddress => !!a))
      .subscribe((address) => {
        this.savedAddresses.update((list) => [
          address,
          ...list.map((a) => (address.isDefault ? { ...a, isDefault: false } : a)),
        ]);
        this.selectAddress(address.id);
      });
  }

  protected clearCart(): void {
    this.cart.clear().subscribe();
  }

  protected placeOrder(): void {
    const quote = this.quote();
    const addressId = this.selectedAddressId();
    if (!quote?.canCheckout || !addressId || this.noteForm().invalid()) return;

    this.placing.set(true);
    this.placeError.set(null);
    this.orders
      .place(
        {
          addressId,
          paymentMethod: this.paymentMethod(),
          paymentChannel: this.cart.paymentChannel() ?? undefined,
          note: this.noteForm.note().value().trim() || undefined,
          expectedTotalPaise: quote.pricing.totalPaise,
        },
        this.idempotencyKey,
      )
      .subscribe({
        next: async ({ order, checkout }) => {
          this.idempotencyKey = newIdempotencyKey();
          if (checkout && !(await this.payOnline(order.id, checkout))) return;
          this.cart.reset();
          void this.router.navigate(['/orders', order.id], { queryParams: { placed: 1 } });
        },
        error: (err: unknown) => {
          this.placing.set(false);
          const code = errorCode(err);
          if (
            code === 'PRICE_CHANGED' ||
            code === 'CART_CHANGED' ||
            code === 'CHECKOUT_BLOCKED' ||
            code === 'COUPON_INVALID' ||
            code === 'COUPON_EXHAUSTED' ||
            // The coin balance changed (spent elsewhere, expired): re-price with what is left.
            code === 'INSUFFICIENT_COINS' ||
            code === 'COINS_NOT_ALLOWED'
          ) {
            this.idempotencyKey = newIdempotencyKey();
            this.cart.refresh().subscribe();
          }
          this.placeError.set(errorMessage(err, 'Could not place your order. Please try again.'));
        },
      });
  }

  private async payOnline(orderId: string, checkout: CheckoutSession): Promise<boolean> {
    let failure: string | null =
      'Payment was not completed, so your order was not placed. Your cart is still here.';
    try {
      const payment = await this.payments.pay(orderId, checkout);
      if (payment?.status === 'paid') return true;
      if (payment?.status === 'failed')
        failure = `Payment failed${payment.failureReason ? ` (${payment.failureReason})` : ''}. Your order was not placed. Please try again.`;
    } catch (err: unknown) {
      failure =
        errorMessage(err, 'Payment could not be completed.') + ' Your order was not placed.';
    }
    try {
      await firstValueFrom(this.payments.abandon(orderId));
    } catch (err: unknown) {
      if (errorCode(err) === 'ORDER_PLACED') return true;
    }
    this.placing.set(false);
    this.placeError.set(failure);
    this.cart.refresh().subscribe();
    return false;
  }

  protected addressLine(a: DeliveryAddress): string {
    return [a.line1, a.line2, a.area, a.city].filter(Boolean).join(', ');
  }

}
