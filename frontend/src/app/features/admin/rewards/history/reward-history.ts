import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AdminRewardsService } from '../../../../core/services/admin/admin-rewards.service';
import {
  BbEmpty,
  DATE_YEAR_TIME,
  DataTable,
  TableColumn,
} from '../../../../shared/components/data-table/data-table';
import { ListEmpty } from '../../../../shared/components/list-empty/list-empty';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { ListToolbar } from '../../../../shared/components/list-toolbar/list-toolbar';
import { datesSection, filteredList, optionsSection } from '../../../../shared/list/filtered-list';
import { REWARD_TYPE_LABEL, RewardClaim } from '../../../../core/models/rewards.models';

/** Reward distribution history: every welcome, birthday and campaign reward given. */
@Component({
  selector: 'bb-reward-history',
  imports: [ListToolbar, ListEmpty, PageHeader, DataTable, BbEmpty],
  templateUrl: './reward-history.html',
  styleUrl: './reward-history.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RewardHistoryPage {
  private readonly api = inject(AdminRewardsService);
  protected readonly filterSections = [
    optionsSection('rewardType', 'Reward', REWARD_TYPE_LABEL),
    optionsSection('status', 'State', { PENDING: 'Paying', ISSUED: 'Paid' }),
    optionsSection('campaign', 'Campaign'), // from the API's counts
    datesSection('claimed', 'Given'),
  ];
  protected readonly claims = filteredList((query) => this.api.claims(query), {
    errorText: 'Could not load the reward history.',
  });
  protected readonly list = this.claims.list;

  protected readonly columns: TableColumn<RewardClaim>[] = [
    { label: 'When', date: (r) => r.claimedAt, dateFormat: DATE_YEAR_TIME },
    { label: 'Customer', value: (r) => r.customer?.name ?? '–', sub: (r) => r.customer?.email },
    {
      label: 'Reward',
      value: (r) => r.campaign?.name ?? REWARD_TYPE_LABEL[r.rewardType] + ' bonus',
      sub: (r) => REWARD_TYPE_LABEL[r.rewardType],
    },
    { label: 'Coins', value: (r) => r.coins, align: 'end' },
    {
      label: 'State',
      badge: (r) => (r.status === 'ISSUED' ? { label: 'Paid', tone: 'good' } : { label: 'Paying', tone: 'warn' }),
    },
  ];
}
