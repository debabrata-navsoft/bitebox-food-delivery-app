import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import {
  AdminRiderAccountsService,
  RiderAccountRow,
} from '../../../core/services/admin/admin-rider-accounts.service';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { DataTable, TableColumn } from '../../../shared/components/data-table/data-table';
import { VEHICLE_LABEL } from '../../../core/models/checkout.models';
import { RIDER_VERIFICATION_LABEL, RIDER_VERIFICATION_TONE } from '../../../core/models/order-management.models';
import { accountStatusBadge, personColumn, ratingColumn, viewEditActions } from '../account-list';
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
import { kycStatusBadge } from '../restaurant-accounts/restaurant-status';
import { availabilityOf } from './rider-status';

/**
 * Account management → Delivery partner accounts: riders with their vehicle, zone, deliveries,
 * rating, verification, KYC, availability and account status. Filters run on the server.
 */
@Component({
  selector: 'bb-admin-rider-accounts',
  imports: [PageHeader, ListToolbar, DataTable],
  templateUrl: './admin-rider-accounts.html',
  styleUrl: './admin-rider-accounts.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminRiderAccounts {
  private readonly api = inject(AdminRiderAccountsService);
  private readonly auth = inject(AuthService);

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

  protected readonly columns: TableColumn<RiderAccountRow>[] = [
    {
      ...personColumn('Delivery partner', '/admin/delivery-partner-accounts'),
      badge: (r) => accountStatusBadge(r, { onlyIfInactive: true }),
      sub: (r) => [r.email, r.phone || 'No mobile'],
    },
    {
      label: 'Vehicle',
      value: (r) => (r.vehicleType ? VEHICLE_LABEL[r.vehicleType] : null),
      tag: (r) => r.vehicleNumber?.toUpperCase(),
    },
    { label: 'Zone', value: (r) => r.zone },
    { label: 'Deliveries', value: (r) => r.completedDeliveries, align: 'end' },
    ratingColumn((r) => r.rating),
    { label: 'Joined', date: (r) => r.createdAt, nowrap: true },
    {
      // Verification, KYC and availability, one under another.
      label: 'Status',
      badge: (r) => [
        {
          label: RIDER_VERIFICATION_LABEL[r.verificationStatus],
          tone: RIDER_VERIFICATION_TONE[r.verificationStatus],
        },
        kycStatusBadge(r.kycStatus),
        availabilityOf(r),
      ],
    },
  ];
  protected readonly actions = viewEditActions<RiderAccountRow>('/admin/delivery-partner-accounts', () =>
    this.auth.can('riders:edit'),
  );
}
