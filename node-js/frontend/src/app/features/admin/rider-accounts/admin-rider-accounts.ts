import { DatePipe, LowerCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IconComponent, PaginationComponent, SelectOption } from 'nexprime';
import { AuthService } from '../../../core/auth/auth.service';
import { KycState } from '../../../core/services/admin/admin-restaurant-accounts.service';
import {
  AdminRiderAccountsService,
  RiderAccountSort,
  RiderAvailabilityFilter,
} from '../../../core/services/admin/admin-rider-accounts.service';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { loaded } from '../../../shared/coupons/coupon-list';
import { NP_FORM_FIELDS } from '../../../shared/forms/np-form-fields';
import { TableLabels } from '../../../shared/list/table-labels';
import { VEHICLE_LABEL, VehicleType } from '../../../shared/models/checkout.models';
import {
  RIDER_VERIFICATION_LABEL,
  RIDER_VERIFICATION_TONE,
  RiderVerificationStatus,
} from '../../../shared/models/order-management.models';
import { USER_STATUS_META, UserStatus, initialsOf } from '../../../shared/models/user.models';
import { accountList, selectOptions, shortId } from '../account-list';
import { KYC_META } from '../restaurant-accounts/restaurant-status';
import { availabilityOf } from './rider-status';

/**
 * Account management → Delivery partner accounts: riders with their vehicle, zone, deliveries,
 * rating, verification, KYC, availability and account status. Filters run on the server.
 */
@Component({
  selector: 'bb-admin-rider-accounts',
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
  templateUrl: './admin-rider-accounts.html',
  styleUrl: './admin-rider-accounts.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminRiderAccounts {
  private readonly api = inject(AdminRiderAccountsService);
  protected readonly auth = inject(AuthService);
  protected readonly shortId = shortId;
  protected readonly initials = initialsOf;
  protected readonly availability = availabilityOf;
  protected readonly verificationLabel = RIDER_VERIFICATION_LABEL;
  protected readonly verificationTone = RIDER_VERIFICATION_TONE;
  protected readonly kycMeta = KYC_META;
  protected readonly accountMeta = USER_STATUS_META;
  protected readonly vehicleLabel = VEHICLE_LABEL;

  protected readonly verificationOptions = selectOptions('Any verification', RIDER_VERIFICATION_LABEL, [
    'pending',
    'approved',
    'resubmission_requested',
    'rejected',
  ]);
  protected readonly availabilityOptions = selectOptions('Online or offline', {
    online: 'Online',
    busy: 'On a delivery',
    offline: 'Offline',
  });
  protected readonly kycOptions = selectOptions('Any KYC status', KYC_META);
  protected readonly accountOptions = selectOptions('Any account status', USER_STATUS_META);
  protected readonly vehicleOptions = selectOptions('Any vehicle', VEHICLE_LABEL);
  protected readonly sortOptions: SelectOption[] = [
    { value: 'newest', label: 'Newest first' },
    { value: 'oldest', label: 'Oldest first' },
    { value: 'name', label: 'Name A–Z' },
    { value: 'deliveries', label: 'Most deliveries' },
    { value: 'rating', label: 'Highest rated' },
  ];
  private readonly zoneList = rxResource({ stream: () => this.api.zones() });
  protected readonly zoneOptions = computed<SelectOption[]>(() => [
    { value: '', label: 'All zones' },
    ...(loaded(this.zoneList) ?? []).map((z) => ({ value: z, label: z })),
  ]);

  protected readonly accounts = accountList(
    {
      search: '',
      verification: '' as RiderVerificationStatus | '',
      availability: '' as RiderAvailabilityFilter | '',
      kyc: '' as KycState | '',
      accountStatus: '' as UserStatus | '',
      zone: '',
      vehicleType: '' as VehicleType | '',
      joinedFrom: null as Date | null,
      joinedTo: null as Date | null,
      sort: 'newest' as RiderAccountSort,
    },
    (query) => this.api.list(query),
    'Could not load delivery partners.',
  );
  protected readonly filters = this.accounts.filters;
  protected readonly list = this.accounts.list;
}
