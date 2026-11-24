import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DetailNav } from '../../../../shared/components/detail-nav/detail-nav';
import { rxResource } from '@angular/core/rxjs-interop';
import { AdminRestaurantStore } from '../../../../core/services/admin/admin-restaurant-accounts.service';
import { MyRestaurantService } from '../../../../core/services/my-restaurant.service';
import { loaded } from '../../../../shared/coupons/coupon-list';
import { RestaurantDetails } from '../../../../shared/components/restaurant-details/restaurant-details';
import { RestaurantLegalForm } from '../../../../shared/components/restaurant-legal-form/restaurant-legal-form';

/**
 * Edit a restaurant account: the partner's own details and legal forms, saving through the admin
 * API (an admin MyRestaurantService). Approval, commission and bank details are changed elsewhere.
 */
@Component({
  selector: 'bb-restaurant-account-edit',
  imports: [DetailNav, RestaurantDetails, RestaurantLegalForm],
  providers: [{ provide: MyRestaurantService, useClass: AdminRestaurantStore }],
  templateUrl: './restaurant-account-edit.html',
  styleUrl: './restaurant-account-edit.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestaurantAccountEdit {
  private readonly store = inject(MyRestaurantService);
  readonly id = input.required<string>();
  protected readonly state = rxResource({ stream: () => this.store.get() });
  protected readonly restaurant = computed(() => loaded(this.state)?.restaurant ?? null);
}
