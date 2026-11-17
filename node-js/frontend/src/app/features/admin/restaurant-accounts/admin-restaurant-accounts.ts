import { DatePipe, LowerCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IconComponent, PaginationComponent, SelectOption } from 'nexprime';
import { AuthService } from '../../../core/auth/auth.service';
import {
  AdminRestaurantAccountsService,
  KycState,
  RestaurantAccountSort,
} from '../../../core/services/admin/admin-restaurant-accounts.service';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { loaded } from '../../../shared/coupons/coupon-list';
import { NP_FORM_FIELDS } from '../../../shared/forms/np-form-fields';
import { TableLabels } from '../../../shared/list/table-labels';
import { RestaurantStatus } from '../../../shared/models/catalog.models';
import { USER_STATUS_META, UserStatus } from '../../../shared/models/user.models';
import { accountList, selectOptions, shortId } from '../account-list';
import { KYC_META, RESTAURANT_STATUS_LABEL, RESTAURANT_STATUS_TONE } from './restaurant-status';

/**
 * Account management → Restaurant accounts: every restaurant partner with their restaurant,
 * owner, orders, rating, commission, approval, KYC and account status. Filters run on the server.
 */
@Component({
  selector: 'bb-admin-restaurant-accounts',
  imports: [
    DatePipe,
    LowerCasePipe,
    RouterLink,
    NP_FORM_FIELDS,
    IconComponent,
    PaginationComponent,
    PageHeader,
    TableLabels,
  ],
  templateUrl: './admin-restaurant-accounts.html',
  styleUrl: './admin-restaurant-accounts.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminRestaurantAccounts {
  private readonly api = inject(AdminRestaurantAccountsService);
  protected readonly auth = inject(AuthService);
  protected readonly shortId = shortId;
  protected readonly statusLabel = RESTAURANT_STATUS_LABEL;
  protected readonly statusTone = RESTAURANT_STATUS_TONE;
  protected readonly kycMeta = KYC_META;
  protected readonly accountMeta = USER_STATUS_META;

  protected readonly statusOptions = selectOptions('Any approval status', RESTAURANT_STATUS_LABEL);
  protected readonly accountOptions = selectOptions('Any account status', USER_STATUS_META);
  protected readonly kycOptions = selectOptions('Any KYC status', KYC_META);
  protected readonly sortOptions: SelectOption[] = [
    { value: 'newest', label: 'Newest first' },
    { value: 'oldest', label: 'Oldest first' },
    { value: 'name', label: 'Name A–Z' },
    { value: 'orders', label: 'Most orders' },
    { value: 'rating', label: 'Highest rated' },
  ];
  private readonly cityList = rxResource({ stream: () => this.api.cities() });
  protected readonly cityOptions = computed<SelectOption[]>(() => [
    { value: '', label: 'All cities' },
    ...(loaded(this.cityList) ?? []).map((c) => ({ value: c, label: c })),
  ]);

  protected readonly accounts = accountList(
    {
      search: '',
      status: '' as RestaurantStatus | '',
      accountStatus: '' as UserStatus | '',
      kyc: '' as KycState | '',
      city: '',
      joinedFrom: null as Date | null,
      joinedTo: null as Date | null,
      sort: 'newest' as RestaurantAccountSort,
    },
    (query) => this.api.list(query),
    'Could not load restaurant accounts.',
  );
  protected readonly filters = this.accounts.filters;
  protected readonly list = this.accounts.list;
}
