import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { errorMessage } from '../../../shared/utils/api-error';
import { NotificationService } from '../../../core/services/notification.service';
import { ReportsService } from '../../../core/services/reports.service';
import { OrderStatusChip } from '../../../shared/components/order-status-chip/order-status-chip';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { datesSection, filteredList, optionsSection } from '../../../shared/list/filtered-list';
import {
  AdminPayment,
  PAYMENT_STATUS_LABEL,
  PROVIDER_LABEL,
  paymentTone,
} from '../../../core/models/payment.models';
import {
  BbCell,
  DATE_TIME,
  DataTable,
  TableAction,
  TableColumn,
} from '../../../shared/components/data-table/data-table';
import { AuthService } from '../../../core/auth/auth.service';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { openRefund } from './refund-dialog/refund-dialog';

@Component({
  selector: 'bb-admin-payments',
  imports: [ListToolbar, OrderStatusChip, PageHeader, DataTable, BbCell],
  templateUrl: './admin-payments.html',
  styleUrl: './admin-payments.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminPayments {
  private readonly api = inject(ReportsService);
  private readonly dialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);

  protected readonly canRefund = inject(AuthService).can('refunds:manage');
  protected readonly filterSections = [
    optionsSection('status', 'Payment status', PAYMENT_STATUS_LABEL),
    optionsSection('method', 'Payment method', { cod: 'Cash on delivery', online: 'Online' }),
    optionsSection('provider', 'Provider', PROVIDER_LABEL),
    // Cancelled and rejected orders that were paid still hold money: finance refunds them from here.
    optionsSection('orderState', 'Order', {
      active: 'Active orders',
      delivered: 'Delivered',
      cancelled: 'Cancelled or rejected',
    }),
    optionsSection('restaurant', 'Restaurant'), // from the API's counts
    datesSection('created', 'Date', ['from', 'to']),
  ];
  protected readonly refunding = signal<string | null>(null);

  protected readonly payments = filteredList((query) => this.api.payments(query), {
    errorText: 'Could not load payments.',
    pollMs: 60_000,
    instants: true,
  });
  protected readonly list = this.payments.list;

  protected readonly columns: TableColumn<AdminPayment>[] = [
    {
      label: 'Order',
      value: (p) => p.order?.orderNumber ?? 'Order removed',
      link: (p) => (p.order ? ['/admin/orders', p.order.id] : null),
      nowrap: true,
    },
    { label: 'Customer', value: (p) => p.customer?.name },
    {
      label: 'Method',
      value: (p) => PROVIDER_LABEL[p.provider],
      tag: (p) => p.providerPaymentId,
    },
    { label: 'Date', date: (p) => p.createdAt, dateFormat: DATE_TIME, nowrap: true },
    { label: 'Amount', paise: (p) => p.amountPaise, strong: true },
    { label: 'Order status', align: 'center', key: 'orderStatus' },
    {
      label: 'Payment',
      align: 'center',
      badge: (p) => ({ label: PAYMENT_STATUS_LABEL[p.status], tone: paymentTone(p.status) }),
      sub: (p) => p.failureReason,
    },
  ];
  /** Retry a failed refund; otherwise refund what's left, or look at the refunds made. */
  protected readonly actions: TableAction<AdminPayment>[] = [
    {
      icon: 'rotate-ccw',
      label: 'Retry refund',
      run: (p) => this.retryRefund(p),
      disabled: (p) => this.refunding() === p.id,
      show: (p) => this.retryable(p),
    },
    {
      icon: 'undo-2',
      label: 'Refund',
      run: (p) => this.refunds(p),
      show: (p) => !this.retryable(p) && this.canRefund && (p.refundablePaise ?? 0) > 0,
    },
    {
      icon: 'receipt-text',
      label: 'Refunds',
      run: (p) => this.refunds(p),
      show: (p) =>
        !this.retryable(p) && this.hasRefunds(p) && !(this.canRefund && (p.refundablePaise ?? 0) > 0),
    },
  ];


  private retryable(p: AdminPayment): boolean {
    return p.refundNeeded && this.canRefund;
  }

  /** Something to refund, or refunds to look at. */
  protected hasRefunds(p: AdminPayment): boolean {
    return (p.refundablePaise ?? 0) > 0 || (p.refundedPaise ?? 0) > 0;
  }

  protected refunds(p: AdminPayment): void {
    openRefund(this.dialog, p).subscribe(() => this.list.reload());
  }

  protected retryRefund(p: AdminPayment): void {
    this.refunding.set(p.id);
    this.api.retryRefund(p.id).subscribe({
      next: (payment) => {
        this.refunding.set(null);
        if (payment.status === 'refunded') this.notify.success('Refunded');
        else this.notify.error(payment.failureReason ?? 'The refund failed again.');
        this.list.reload();
      },
      error: (err: unknown) => {
        this.refunding.set(null);
        this.notify.error(errorMessage(err));
      },
    });
  }
}
