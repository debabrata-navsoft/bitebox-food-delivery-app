import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { IconComponent, PaginationComponent } from 'nexprime';
import { errorMessage } from '../../../core/services/api-error';
import { NotificationService } from '../../../core/services/notification.service';
import { AdminOrdersService } from '../../../core/services/order-management.service';
import { confirmed } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { OrderStatusChip } from '../../../shared/components/order-status-chip/order-status-chip';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { filterOptions, filteredList } from '../../../shared/list/filtered-list';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { FilterSection } from '../../../shared/components/filter-panel/filter-panel.models';
import { OrderStatus, VEHICLE_LABEL } from '../../../shared/models/checkout.models';
import {
  AdminRider,
  RIDER_VERIFICATION_LABEL,
  RIDER_VERIFICATION_TONE,
  RiderReviewState,
  riderReviewState,
} from '../../../shared/models/order-management.models';
import { RouterLink } from '@angular/router';
import { openAdminOrder } from '../orders/admin-order-dialog/admin-order-dialog';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
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
    IconComponent,
    PaginationComponent,
    EmptyState,
    ListToolbar,
    OrderStatusChip,
    PageHeader,
  ],
  templateUrl: './admin-delivery-partners.html',
  styleUrl: './admin-delivery-partners.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDeliveryPartners implements OnInit {
  private readonly api = inject(AdminOrdersService);
  private readonly bbDialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);

  /** ?verification=pending (the dashboards' "Review" shortcut) preselects that filter. */
  readonly verification = input<RiderReviewState>();
  protected readonly verificationLabel = RIDER_VERIFICATION_LABEL;
  protected readonly verificationTone = RIDER_VERIFICATION_TONE;
  /** "Not submitted" for a pending rider who has not sent everything yet. */
  protected readonly stateOf = (r: AdminRider): RiderReviewState | null =>
    r.verificationStatus ? riderReviewState({ status: r.verificationStatus, submitted: r.submitted }) : null;
  protected readonly busyId = signal<string | null>(null);
  protected readonly vehicleLabel = VEHICLE_LABEL;

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

  ngOnInit(): void {
    const preset = this.verification();
    if (preset && preset in RIDER_VERIFICATION_LABEL) this.riders.panel.set({ verification: [preset] });
  }

  protected openOrder(id: string): void {
    openAdminOrder(this.bbDialog, id).subscribe(() => this.list.reload());
  }

  protected toggleStatus(rider: AdminRider): void {
    const suspend = rider.status === 'active';
    confirmed(
      this.bbDialog,
      suspend
        ? {
            title: `Suspend ${rider.name}?`,
            message: 'They are taken offline and signed out, and cannot accept deliveries.',
            confirmLabel: 'Suspend',
            danger: true,
          }
        : {
            title: `Reactivate ${rider.name}?`,
            message: 'They can sign in and go online again.',
            confirmLabel: 'Reactivate',
          },
      '420px',
    ).subscribe(() => {
      this.busyId.set(rider.id);
      this.api.setRiderStatus(rider.id, suspend ? 'suspended' : 'active').subscribe({
        next: () => {
          this.busyId.set(null);
          this.notify.success(suspend ? 'Rider suspended' : 'Rider reactivated');
          this.list.reload();
        },
        error: (err: unknown) => {
          this.busyId.set(null);
          this.notify.error(errorMessage(err));
        },
      });
    });
  }
}
