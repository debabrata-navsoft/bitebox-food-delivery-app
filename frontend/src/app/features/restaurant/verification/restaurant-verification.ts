import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Restaurant } from '../../../core/models/catalog.models';
import { MyRestaurantService } from '../../../core/services/my-restaurant.service';
import { NotificationService } from '../../../core/services/notification.service';
import { KycVerification } from '../../../shared/components/kyc/kyc-verification/kyc-verification';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { RestaurantLegalForm } from '../../../shared/components/restaurant-legal-form/restaurant-legal-form';
import { errorMessage } from '../../../shared/utils/api-error';
import { StatusBanner } from '../status-banner/status-banner';

/**
 * What BiteBox needs before a restaurant goes live: legal and tax details (FSSAI, GST),
 * documents, and the bank account for payouts. After "documents needed", send it for review again.
 */
@Component({
  selector: 'bb-restaurant-verification',
  imports: [RouterLink, RestaurantLegalForm, PageHeader, StatusBanner, KycVerification],
  templateUrl: './restaurant-verification.html',
  styleUrl: './restaurant-verification.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestaurantVerification {
  private readonly restaurants = inject(MyRestaurantService);
  private readonly notify = inject(NotificationService);
  private readonly verification = viewChild(KycVerification);

  /** undefined while loading, null when the partner has no restaurant yet. */
  protected readonly restaurant = signal<Restaurant | null | undefined>(undefined);
  protected readonly canResubmit = computed(() =>
    ['rejected', 'resubmission_requested'].includes(this.restaurant()?.status ?? ''),
  );
  protected readonly resubmit = () => this.restaurants.resubmit();

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
    this.verification()?.reloadDocuments();
  }
}
