import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { IconComponent } from 'nexprime';
import { AdminOrdersService } from '../../../core/services/order-management.service';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { FilterSection } from '../../../shared/components/filter-panel/filter-panel.models';
import { OrderStatusChip } from '../../../shared/components/order-status-chip/order-status-chip';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { filterOptions, filteredList } from '../../../shared/list/filtered-list';
import {
  ORDER_STATUS_LABEL,
  Order,
  PaymentStatus,
  customerStatusLabel,
} from '../../../core/models/checkout.models';
import { PAYMENT_STATUS_LABEL } from '../../../core/models/payment.models';
import { itemCount } from '../../../shared/pipes/item-count.pipe';
import {
  BbCell,
  DATE_TIME,
  DataTable,
  TableColumn,
} from '../../../shared/components/data-table/data-table';
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
    RouterLink,
    IconComponent,
    ListToolbar,
    OrderStatusChip,
    PageHeader,
    DataTable,
    BbCell,
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

  protected readonly columns: TableColumn<Order>[] = [
    { label: 'Order', value: (o) => o.orderNumber, run: (o) => this.open(o.id), nowrap: true },
    { label: 'Restaurant', value: (o) => o.restaurantSnapshot.name, sub: itemCount },
    { label: 'Placed', date: (o) => o.createdAt, dateFormat: DATE_TIME, nowrap: true },
    { label: 'Payment', value: (o) => (o.paymentMethod === 'cod' ? 'Cash' : 'Online') },
    { label: 'Total', paise: (o) => o.pricing.totalPaise, strong: true },
    { label: 'Status', key: 'status' },
  ];

  protected open(id: string): void {
    openAdminOrder(this.dialog, id).subscribe(() => this.list.reload());
  }
}
