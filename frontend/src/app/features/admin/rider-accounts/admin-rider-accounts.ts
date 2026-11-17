import { DatePipe, LowerCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent, PaginationComponent } from 'nexprime';
import { AuthService } from '../../../core/auth/auth.service';
import { AdminRiderAccountsService } from '../../../core/services/admin/admin-rider-accounts.service';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { TableLabels } from '../../../shared/list/table-labels';
import { VEHICLE_LABEL } from '../../../shared/models/checkout.models';
import { RIDER_VERIFICATION_LABEL, RIDER_VERIFICATION_TONE } from '../../../shared/models/order-management.models';
import { USER_STATUS_META, initialsOf } from '../../../shared/models/user.models';
import { shortId } from '../account-list';
import {
  JOINED_SECTION,
  KYC_SECTION,
  RIDER_AVAILABILITY_SECTION,
  VEHICLE_SECTION,
  ZONE_SECTION,
  accountSorts,
  accountStatusSection,
} from '../filter-sections';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { FilterSection } from '../../../shared/components/filter-panel/filter-panel.models';
import { filterOptions, filteredList } from '../../../shared/list/filtered-list';
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
    IconComponent,
    PaginationComponent,
    PageHeader,
    TableLabels,
    ListToolbar,
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

  protected readonly filterSections: FilterSection[] = [
    {
      kind: 'options',
      key: 'verification',
      label: 'Verification',
      options: filterOptions(RIDER_VERIFICATION_LABEL, ['pending', 'approved', 'resubmission_requested', 'rejected']),
    },
    RIDER_AVAILABILITY_SECTION,
    KYC_SECTION,
    accountStatusSection('accountStatus', 'Account status'),
    ZONE_SECTION,
    VEHICLE_SECTION,
    JOINED_SECTION,
  ];
  protected readonly sortOptions = accountSorts({ deliveries: 'Most deliveries', rating: 'Highest rated' });

  protected readonly accounts = filteredList((query) => this.api.list(query), {
    errorText: 'Could not load delivery partners.',
    sort: 'newest',
  });
  protected readonly list = this.accounts.list;
}
