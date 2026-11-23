import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { filter } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { AdminRewardsService } from '../../../../core/services/admin/admin-rewards.service';
import { NotificationService } from '../../../../core/services/notification.service';
import {
  BbCell,
  BbEmpty,
  DATE_YEAR_TIME,
  DataTable,
  TableAction,
  TableColumn,
} from '../../../../shared/components/data-table/data-table';
import { ListEmpty } from '../../../../shared/components/list-empty/list-empty';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { ListToolbar } from '../../../../shared/components/list-toolbar/list-toolbar';
import { datesSection, filteredList, optionsSection } from '../../../../shared/list/filtered-list';
import {
  AdminCoinTransaction,
  SOURCE_LABEL,
  TXN_TYPE_LABEL,
  coinChange,
} from '../../../../core/models/rewards.models';
import { ReverseDialog } from '../reverse-dialog/reverse-dialog';
import { WalletDialog } from '../wallet-dialog/wallet-dialog';

/** The coin ledger across all customers, with wallet details and reward reversals. */
@Component({
  selector: 'bb-coin-transactions',
  imports: [ListToolbar, ListEmpty, PageHeader, DataTable, BbCell, BbEmpty],
  templateUrl: './coin-transactions.html',
  styleUrl: './coin-transactions.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoinTransactionsPage {
  private readonly api = inject(AdminRewardsService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotificationService);
  protected readonly canManage = inject(AuthService).can('rewards:manage');
  /** ?userId= from other pages (one customer's history). */
  readonly userId = input<string>();

  /** The customer whose history is shown ('' for everyone). */
  protected readonly customer = signal('');

  protected readonly filterSections = [
    optionsSection('type', 'Type', TXN_TYPE_LABEL),
    optionsSection('source', 'Source', SOURCE_LABEL),
    optionsSection('campaign', 'Campaign'), // from the API's counts
    datesSection('created', 'Date', ['from', 'to']),
  ];

  constructor() {
    effect(() => {
      const id = this.userId() ?? '';
      untracked(() => this.customer.set(id));
    });
  }

  protected readonly transactions = filteredList((query) => this.api.transactions(query), {
    errorText: 'Could not load coin transactions.',
    instants: true,
    extra: () => ({ userId: this.customer() || undefined }),
  });
  protected readonly list = this.transactions.list;

  protected readonly columns: TableColumn<AdminCoinTransaction>[] = [
    { label: 'When', date: (t) => t.createdAt, dateFormat: DATE_YEAR_TIME },
    {
      label: 'Customer',
      value: (t) => t.customer?.name,
      run: (t) => this.wallet(t),
      sub: (t) => t.customer?.email,
    },
    { label: 'What', key: 'what' },
    { label: 'Coins', key: 'change', align: 'end' },
    { label: 'Balance', value: (t) => t.balanceAfter, align: 'end' },
  ];
  protected readonly actions: TableAction<AdminCoinTransaction>[] = [
    {
      icon: 'undo-2',
      label: 'Reverse',
      run: (t) => this.reverse(t),
      show: (t) => this.canManage && t.type === 'CREDIT',
    },
  ];

  protected clearCustomer(): void {
    this.customer.set('');
  }

  protected wallet(t: AdminCoinTransaction): void {
    if (t.customer) this.dialog.open(WalletDialog, { data: t.customer.id, width: '760px', maxWidth: '95vw' });
  }

  protected reverse(t: AdminCoinTransaction): void {
    this.dialog
      .open<ReverseDialog, AdminCoinTransaction, AdminCoinTransaction>(ReverseDialog, { data: t, width: '480px', maxWidth: '95vw' })
      .afterClosed()
      .pipe(filter(Boolean))
      .subscribe((row) => {
        this.notify.success(
          row.shortfall ? `${row.coins} coins reversed; ${row.shortfall} were already spent` : `${row.coins} coins reversed`,
        );
        this.list.reload();
      });
  }

  protected readonly typeLabel = TXN_TYPE_LABEL;
  protected readonly sourceLabel = SOURCE_LABEL;
  protected readonly coinChange = coinChange;
}
