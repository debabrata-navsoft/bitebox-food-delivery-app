import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../../core/services/api-error';
import { KycService } from '../../../core/services/kyc.service';
import { MyRestaurantService } from '../../../core/services/my-restaurant.service';
import { NotificationService } from '../../../core/services/notification.service';
import { KycDocuments } from '../../../shared/components/kyc/kyc-documents/kyc-documents';
import { PayoutAccountForm } from '../../../shared/components/kyc/payout-account-form/payout-account-form';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { Restaurant } from '../../../shared/models/catalog.models';
import { KycSummary } from '../../../shared/models/kyc.models';
import { StatusBanner } from '../status-banner/status-banner';
import { RestaurantLegalForm } from './legal-form/restaurant-legal-form';

/**
 * What BiteBox needs before a restaurant goes live: legal and tax details (FSSAI, GST),
 * documents, and the bank account for payouts. After "documents needed", send it for review again.
 */
@Component({
  selector: 'bb-restaurant-verification',
  imports: [
    RouterLink,
    RestaurantLegalForm,
    PageHeader,
    StatusBanner,
    KycDocuments,
    PayoutAccountForm,
  ],
  templateUrl: './restaurant-verification.html',
  styleUrl: './restaurant-verification.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestaurantVerification {
  private readonly restaurants = inject(MyRestaurantService);
  private readonly kyc = inject(KycService);
  private readonly notify = inject(NotificationService);

  protected readonly restaurant = signal<Restaurant | null | undefined>(undefined);
  protected readonly kycData = rxResource({ stream: () => this.kyc.summary() });
  protected readonly summary = computed<KycSummary | null>(() =>
    this.kycData.hasValue() ? this.kycData.value() : null,
  );
  protected readonly canResubmit = computed(() =>
    ['rejected', 'resubmission_requested'].includes(this.restaurant()?.status ?? ''),
  );
  protected readonly resubmitting = signal(false);

  constructor() {
    this.restaurants.get().subscribe({
      next: ({ restaurant }) => this.restaurant.set(restaurant),
      error: (err: unknown) => {
        this.restaurant.set(null);
        this.notify.error(errorMessage(err));
      },
    });
  }

  /** The legal details changed: GST decides which documents are needed. */
  protected legalSaved(restaurant: Restaurant): void {
    this.restaurant.set(restaurant);
    this.kycData.reload();
  }

  protected resubmit(): void {
    this.resubmitting.set(true);
    this.restaurants.resubmit().subscribe({
      next: (restaurant) => {
        this.resubmitting.set(false);
        this.restaurant.set(restaurant);
        this.notify.success('Sent for review. We will let you know soon.');
      },
      error: (err: unknown) => {
        this.resubmitting.set(false);
        this.notify.error(errorMessage(err));
      },
    });
  }

  protected bankSaved(summary: KycSummary): void {
    this.kycData.set(summary);
  }
}
