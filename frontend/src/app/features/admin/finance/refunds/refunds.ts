import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AuthService } from '../../../../core/auth/auth.service';
import { FinanceService } from '../../../../core/services/admin/finance.service';
import { errorMessage } from '../../../../shared/utils/api-error';
import { NotificationService } from '../../../../core/services/notification.service';
import { ReportsService } from '../../../../core/services/reports.service';
import { ListEmpty } from '../../../../shared/components/list-empty/list-empty';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { ListToolbar } from '../../../../shared/components/list-toolbar/list-toolbar';
import {
  BbCell,
  BbEmpty,
  DATE_YEAR_TIME,
  DataTable,
  TableAction,
  TableColumn,
} from '../../../../shared/components/data-table/data-table';
import { datesSection, filteredList, optionsSection } from '../../../../shared/list/filtered-list';
import { RefundRow } from '../../../../core/models/admin-roles.models';
import { dateText } from '../../../../shared/utils/dates';
import { openTransaction } from '../transaction-dialog/transaction-dialog';
import { BbDialog } from '../../../../shared/dialog/bb-dialog';

/**
 * Refund management. Refunds happen automatically when a paid online order is cancelled; this
 * page shows them, and the ones where the automatic refund failed so finance can retry.
 */
@Component({
  selector: 'bb-refunds',
  imports: [DataTable, BbCell, BbEmpty, ListToolbar, ListEmpty, PageHeader],
  templateUrl: './refunds.html',
  styleUrl: './refunds.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RefundsPage {
  private readonly api = inject(FinanceService);
  private readonly payments = inject(ReportsService);
  private readonly dialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);
  private readonly dates = dateText();
  private readonly canRefund = inject(AuthService).can('refunds:manage');
  private readonly busy = signal<string | null>(null);

  protected readonly filterSections = [
    optionsSection('state', 'Refund', { needed: 'Needs a refund', refunded: 'Refunded' }),
    optionsSection('restaurant', 'Restaurant'), // from the API's counts
    datesSection('updated', 'Last change'),
  ];

  protected readonly refunds = filteredList((query) => this.api.refunds(query), {
    errorText: 'Could not load refunds.',
    pollMs: 60_000,
    when: () => false,
  });
  protected readonly list = this.refunds.list;

  protected readonly columns: TableColumn<RefundRow>[] = [
    { label: 'Order', key: 'order' },
    { label: 'Customer', value: (r) => r.customer?.name ?? '–', sub: (r) => r.customer?.email },
    { label: 'Amount', paise: (r) => r.amountPaise },
    {
      label: 'Refund',
      badge: (r) =>
        r.refundNeeded
          ? { label: 'Needs a refund', tone: 'bad' }
          : { label: 'Refunded', tone: 'good' },
      sub: (r) =>
        r.refundNeeded ? r.failureReason : this.dates.day(r.refundedAt, DATE_YEAR_TIME),
    },
  ];
  protected readonly actions: TableAction<RefundRow>[] = [
    {
      icon: 'rotate-ccw',
      label: 'Retry refund',
      text: true,
      run: (r) => this.retry(r),
      show: (r) => r.refundNeeded && this.canRefund,
      disabled: (r) => this.busy() === r.id,
    },
  ];

  protected details(r: RefundRow): void {
    openTransaction(this.dialog, r.id).subscribe();
  }

  private retry(r: RefundRow): void {
    this.busy.set(r.id);
    this.payments.retryRefund(r.id).subscribe({
      next: (payment) => {
        this.busy.set(null);
        if (payment.status === 'refunded') this.notify.success('Refunded');
        else this.notify.error(payment.failureReason ?? 'The refund failed again.');
        this.list.reload();
      },
      error: (err: unknown) => {
        this.busy.set(null);
        this.notify.error(errorMessage(err));
      },
    });
  }
}
