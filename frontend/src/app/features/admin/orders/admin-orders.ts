import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { DatePipe } from '@angular/common';
import { IconComponent, PaginationComponent } from 'nexprime';
import { AdminOrdersService } from '../../../core/services/order-management.service';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { FilterSection } from '../../../shared/components/filter-panel/filter-panel.models';
import { OrderStatusChip } from '../../../shared/components/order-status-chip/order-status-chip';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { filterOptions, filteredList } from '../../../shared/list/filtered-list';
import { ORDER_STATUS_LABEL, PaymentStatus, customerStatusLabel } from '../../../shared/models/checkout.models';
import { PAYMENT_STATUS_LABEL } from '../../../shared/models/payment.models';
import { ItemCountPipe } from '../../../shared/pipes/item-count.pipe';
import { InrPipe } from '../../../shared/pipes/money.pipes';
import { openAdminOrder } from './admin-order-dialog/admin-order-dialog';

/** Whether the customer has paid: [label, badge tone]. Cash is "Not paid" until delivery. */
const PAYMENT_BADGE: Record<PaymentStatus, [string, string]> = {
  paid: ['Paid', 'tone-good'],
  pending: ['Not paid', 'tone-warn'],
  cancelled: ['Not paid', ''],
  failed: ['Payment failed', 'tone-bad'],
  refunded: ['Refunded', 'tone-info'],
  partially_refunded: ['Partly refunded', 'tone-info'],
};

@Component({
  selector: 'bb-admin-orders',
  imports: [
    DatePipe,
    RouterLink,
    IconComponent,
    PaginationComponent,
    EmptyState,
    ListToolbar,
    OrderStatusChip,
    PageHeader,
    InrPipe,
    ItemCountPipe,
  ],
  templateUrl: './admin-orders.html',
  styleUrl: './admin-orders.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminOrders {
  private readonly api = inject(AdminOrdersService);
  private readonly dialog = inject(BbDialog);
  protected readonly statusLabel = customerStatusLabel;
  protected readonly payment = PAYMENT_BADGE;

  /** ?customer=<user id>: one customer's orders (from the admin user page). */
  readonly customer = input<string>();

  protected readonly filterSections: FilterSection[] = [
    { kind: 'options', key: 'status', label: 'Order status', options: filterOptions(ORDER_STATUS_LABEL) },
    { kind: 'options', key: 'paymentMethod', label: 'Payment method', options: filterOptions({ cod: 'Cash', online: 'Online' }) },
    { kind: 'options', key: 'paymentStatus', label: 'Payment status', options: filterOptions(PAYMENT_STATUS_LABEL) },
    // Restaurants that have orders (the API's counts, with their names).
    { kind: 'options', key: 'restaurant', label: 'Restaurant' },
    { kind: 'dates', key: 'placed', label: 'Placed' },
  ];

  protected readonly orders = filteredList((query) => this.api.list(query), {
    errorText: 'Could not load orders.',
    pollMs: 60_000,
    extra: () => ({ customer: this.customer() || undefined }),
  });
  protected readonly list = this.orders.list;

  protected open(id: string): void {
    openAdminOrder(this.dialog, id).subscribe(() => this.list.reload());
  }
}
