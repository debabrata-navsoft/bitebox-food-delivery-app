import { finalize } from 'rxjs';
import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AdminOrdersService } from '../../../core/services/order-management.service';
import { riderStatusAction, riderStatusChanger } from './rider-account-status';
import { OrderStatusChip } from '../../../shared/components/order-status-chip/order-status-chip';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { filterOptions, filteredList } from '../../../shared/list/filtered-list';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { FilterSection } from '../../../shared/components/filter-panel/filter-panel.models';
import { OrderStatus, VEHICLE_LABEL } from '../../../core/models/checkout.models';
import {
  AdminRider,
  RIDER_VERIFICATION_LABEL,
  RIDER_VERIFICATION_TONE,
  RiderReviewState,
  riderReviewState,
} from '../../../core/models/order-management.models';
import { RouterLink } from '@angular/router';
import { openAdminOrder } from '../orders/admin-order-dialog/admin-order-dialog';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import {
  BbCell,
  DataTable,
  TableAction,
  TableColumn,
} from '../../../shared/components/data-table/data-table';
import { accountStatusBadge, stars } from '../account-list';
import { RIDER_AVAILABILITY_SECTION, VEHICLE_SECTION, ZONE_SECTION } from '../filter-sections';

const RIDER_EVENTS: OrderStatus[] = [
  'ready_for_pickup',
  'assigned',
  'arrived_at_restaurant',
  'picked_up',
  'on_the_way',
  'delivered',
  'cancelled',
];

@Component({
  selector: 'bb-admin-delivery-partners',
  imports: [
    RouterLink,
    DatePipe,
    ListToolbar,
    OrderStatusChip,
    PageHeader,
    DataTable,
    BbCell,
  ],
  templateUrl: './admin-delivery-partners.html',
  styleUrl: './admin-delivery-partners.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDeliveryPartners implements OnInit {
  private readonly api = inject(AdminOrdersService);
  private readonly bbDialog = inject(BbDialog);
  private readonly changeStatus = riderStatusChanger();

  /** ?verification=pending (the dashboards' "Review" shortcut) preselects that filter. */
  readonly verification = input<RiderReviewState>();
  /** "Not submitted" for a pending rider who has not sent everything yet. */
  protected readonly stateOf = (r: AdminRider): RiderReviewState | null =>
    r.verificationStatus ? riderReviewState({ status: r.verificationStatus, submitted: r.submitted }) : null;
  protected readonly busyId = signal<string | null>(null);

  protected readonly filterSections: FilterSection[] = [
    { kind: 'options', key: 'verification', label: 'Verification', options: filterOptions(RIDER_VERIFICATION_LABEL) },
    RIDER_AVAILABILITY_SECTION,
    VEHICLE_SECTION,
    ZONE_SECTION,
  ];

  protected readonly riders = filteredList((query) => this.api.riders(query), {
    errorText: 'Could not load delivery partners.',
    pollMs: 60_000,
    when: (e) => RIDER_EVENTS.includes(e.status),
  });
  protected readonly list = this.riders.list;

  protected readonly columns: TableColumn<AdminRider>[] = [
    // The online dot, the name (a link) and "email · phone".
    { label: 'Rider', key: 'rider' },
    {
      label: 'Verification',
      align: 'center',
      badge: (r) => {
        const v = this.stateOf(r);
        return v ? { label: RIDER_VERIFICATION_LABEL[v], tone: RIDER_VERIFICATION_TONE[v] } : null;
      },
    },
    {
      label: 'Vehicle',
      value: (r) => (r.vehicleType ? VEHICLE_LABEL[r.vehicleType] : 'No vehicle'),
      tag: (r) => r.vehicleNumber,
    },
    {
      label: 'Deliveries',
      value: (r) => r.completedDeliveries,
      sub: (r) => (r.rating?.count ? `${stars(r.rating)} (${r.rating.count})` : null),
      align: 'end',
    },
    // The current order (opens it) and its status, or "Available" / "Offline".
    { label: 'Availability', align: 'center', key: 'availability' },
    { label: 'Account', align: 'center', badge: (r) => accountStatusBadge(r) },
  ];
  protected readonly actions: TableAction<AdminRider>[] = [
    {
      icon: 'shield-alert',
      text: true,
      label: (r) => riderStatusAction(r.status),
      danger: (r) => r.status === 'active',
      disabled: (r) => this.busyId() === r.id,
      run: (r) => this.toggleStatus(r),
    },
  ];

  ngOnInit(): void {
    const preset = this.verification();
    if (preset && preset in RIDER_VERIFICATION_LABEL) this.riders.panel.set({ verification: [preset] });
  }

  protected openOrder(id: string): void {
    openAdminOrder(this.bbDialog, id).subscribe(() => this.list.reload());
  }

  protected toggleStatus(rider: AdminRider): void {
    this.busyId.set(rider.id);
    this.changeStatus(rider)
      .pipe(finalize(() => this.busyId.set(null)))
      .subscribe(() => this.list.reload());
  }
}
