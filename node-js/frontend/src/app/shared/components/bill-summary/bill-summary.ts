import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Pricing } from '../../models/checkout.models';
import { DistancePipe, InrPipe } from '../../pipes/money.pipes';

@Component({
  selector: 'bb-bill-summary',
  imports: [InrPipe, DistancePipe],
  templateUrl: './bill-summary.html',
  styleUrl: './bill-summary.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BillSummary {
  readonly pricing = input.required<Pricing>();
  readonly couponCode = input<string | undefined>();
  readonly distanceMeters = input<number | null | undefined>();
  /** Coins used for the coin discount line. */
  readonly coinsRedeemed = input<number | null | undefined>();

  /** Coupon discount, waived delivery fee and coins together. */
  protected readonly saved = computed(() => {
    const p = this.pricing();
    return p.discountPaise + (p.deliveryDiscountPaise ?? 0) + (p.coinDiscountPaise ?? 0);
  });
}
