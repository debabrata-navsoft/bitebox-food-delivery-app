import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ButtonComponent, IconComponent, PaginationComponent } from 'nexprime';
import { errorMessage } from '../../../core/services/api-error';
import { NotificationService } from '../../../core/services/notification.service';
import { ReportsService } from '../../../core/services/reports.service';
import { ListEmpty } from '../../../shared/components/list-empty/list-empty';
import { OrderStatusChip } from '../../../shared/components/order-status-chip/order-status-chip';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { datesSection, filteredList, optionsSection } from '../../../shared/list/filtered-list';
import { AdminPayment, PAYMENT_STATUS_LABEL, PROVIDER_LABEL } from '../../../shared/models/payment.models';
import { InrPipe } from '../../../shared/pipes/money.pipes';
import { AuthService } from '../../../core/auth/auth.service';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { openTransaction } from '../finance/transaction-dialog/transaction-dialog';
import { openRefund } from './refund-dialog/refund-dialog';

@Component({
  selector: 'bb-admin-payments',
  imports: [
    DatePipe,
    ListToolbar,
    ButtonComponent,
    IconComponent,
    PaginationComponent,
    ListEmpty,
    OrderStatusChip,
    PageHeader,
    InrPipe,
  ],
  templateUrl: './admin-payments.html',
  styleUrl: './admin-payments.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminPayments {
  private readonly api = inject(ReportsService);
  private readonly dialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);

  protected readonly statusLabel = PAYMENT_STATUS_LABEL;
  protected readonly providerLabel = PROVIDER_LABEL;
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

  protected details(p: AdminPayment): void {
    openTransaction(this.dialog, p.id).subscribe();
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
