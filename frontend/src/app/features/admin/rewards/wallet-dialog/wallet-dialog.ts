import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { IconComponent } from 'nexprime';
import { AdminRewardsService } from '../../../../core/services/admin/admin-rewards.service';
import { resourceError, resourceValue } from '../../../../shared/utils/api-error';
import { DATE_TIME, DataTable, TableColumn } from '../../../../shared/components/data-table/data-table';
import { StatTile } from '../../../../shared/components/stat-tile/stat-tile';
import {
  AdminCoinTransaction,
  AdminWalletDetail,
  SOURCE_LABEL,
  TXN_TYPE_LABEL,
  coinChange,
} from '../../../../core/models/rewards.models';
import { dateText } from '../../../../shared/utils/dates';

/** One customer's wallet: balances, live batches, the ledger check and recent rows. */
@Component({
  selector: 'bb-wallet-dialog',
  imports: [MatDialogModule, MatButtonModule, IconComponent, StatTile, DataTable],
  templateUrl: './wallet-dialog.html',
  styleUrl: './wallet-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalletDialog {
  private readonly userId = inject<string>(MAT_DIALOG_DATA);
  private readonly api = inject(AdminRewardsService);
  private readonly now = Date.now();
  private readonly day = dateText().day;
  protected readonly detail = rxResource({ stream: () => this.api.wallet(this.userId) });
  protected readonly data = resourceValue(this.detail);
  protected readonly error = resourceError(this.detail, 'Could not load the wallet.');

  protected readonly batchColumns: TableColumn<AdminWalletDetail['batches'][number]>[] = [
    { label: 'From', value: (b) => SOURCE_LABEL[b.source] },
    { label: 'Left', value: (b) => `${b.remaining} / ${b.original}`, align: 'end' },
    { label: 'Earned', date: (b) => b.earnedAt },
    {
      label: 'Expires',
      // Past their date: a red badge.
      date: (b) => (this.isPast(b.expiresAt) ? null : b.expiresAt),
      value: (b) => (b.expiresAt ? null : 'Never'),
      badge: (b) => (this.isPast(b.expiresAt) ? { label: this.day(b.expiresAt), tone: 'bad' } : null),
    },
  ];
  protected readonly recentColumns: TableColumn<AdminCoinTransaction>[] = [
    { label: '#', value: (t) => t.seq },
    { label: 'What', value: (t) => TXN_TYPE_LABEL[t.type], sub: (t) => t.description },
    { label: 'Change', value: coinChange, align: 'end' },
    { label: 'Balance', value: (t) => t.balanceAfter, align: 'end' },
    { label: 'When', date: (t) => t.createdAt, dateFormat: DATE_TIME },
  ];

  private isPast(at: string | null): boolean {
    return !!at && new Date(at).getTime() <= this.now;
  }
}
