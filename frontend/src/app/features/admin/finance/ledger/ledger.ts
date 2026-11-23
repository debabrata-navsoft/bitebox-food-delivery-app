import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ButtonComponent, IconComponent } from 'nexprime';
import { FinanceService } from '../../../../core/services/admin/finance.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ListEmpty } from '../../../../shared/components/list-empty/list-empty';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { ListToolbar } from '../../../../shared/components/list-toolbar/list-toolbar';
import {
  BbCell,
  BbEmpty,
  DATE_TIME,
  DataTable,
  TableColumn,
} from '../../../../shared/components/data-table/data-table';
import { datesSection, filteredList, optionsSection } from '../../../../shared/list/filtered-list';
import { LedgerAccount, LedgerSummary } from '../../../../core/models/admin-roles.models';
import { InrPipe } from '../../../../shared/pipes/money.pipes';

// `sign` turns a balance into its natural reading: the ledger stores money held for others (and
// money paid out) as credits, i.e. negative, but the tiles show what is owed or paid as positive.
const ACCOUNT: Record<LedgerAccount, { label: string; hint: string; sign: 1 | -1 }> = {
  customer_payments: {
    label: 'Customer payments',
    hint: 'Collected for delivered orders, less refunds',
    sign: 1,
  },
  restaurant_payable: {
    label: 'Owed to restaurants',
    hint: 'Their shares, less what has been paid out',
    sign: -1,
  },
  rider_payable: {
    label: 'Owed to riders',
    hint: 'Delivery pay, less what has been paid out',
    sign: -1,
  },
  platform_revenue: {
    label: 'BiteBox revenue',
    hint: 'Commission and fees, after refunds BiteBox carries',
    sign: -1,
  },
  tax_payable: { label: 'Tax collected', hint: 'GST on orders, due to the government', sign: -1 },
  payouts: { label: 'Paid out', hint: 'Transfers to restaurants and riders', sign: -1 },
};

/**
 * The finance ledger: every delivered order, payout and refund after delivery as balanced
 * double-entry rows. Tiles show each balance in its natural direction; entries keep their signs.
 */
@Component({
  selector: 'bb-ledger',
  imports: [
    DataTable,
    BbCell,
    BbEmpty,
    ButtonComponent,
    IconComponent,
    ListEmpty,
    ListToolbar,
    PageHeader,
    InrPipe,
  ],
  templateUrl: './ledger.html',
  styleUrl: './ledger.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LedgerPage {
  private readonly api = inject(FinanceService);
  private readonly notify = inject(NotificationService);
  protected readonly account = ACCOUNT;
  protected readonly exporting = signal(false);

  protected readonly filterSections = [
    optionsSection('account', 'Account', ACCOUNT),
    optionsSection('event', 'Event', {
      settlement: 'Order delivered',
      payout: 'Payout paid',
      refund: 'Refund after delivery',
    }),
    datesSection('created', 'Date'),
  ];

  /** The entries follow the filters; the balances above them are always the whole ledger. */
  protected readonly entries = filteredList((query) => this.api.ledger(query), {
    errorText: 'Could not load the ledger.',
  });
  protected readonly list = this.entries.list;

  protected readonly columns: TableColumn<LedgerSummary['items'][number]>[] = [
    { label: 'When', date: (e) => e.createdAt, dateFormat: DATE_TIME },
    { label: 'Event', value: (e) => e.description },
    { label: 'Account', value: (e) => ACCOUNT[e.account].label },
    { label: 'Amount', key: 'amount', align: 'end' },
  ];

  protected exportCsv(): void {
    this.exporting.set(true);
    this.api
      .settlementsCsv()
      .catch((err: Error) => this.notify.error(err.message))
      .finally(() => this.exporting.set(false));
  }
}
