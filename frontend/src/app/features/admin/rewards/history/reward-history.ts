import { TableLabels } from '../../../../shared/list/table-labels';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatPaginatorModule } from '@angular/material/paginator';
import { IconComponent } from 'nexprime';
import { AdminRewardsService } from '../../../../core/services/admin/admin-rewards.service';
import { ListEmpty } from '../../../../shared/components/list-empty/list-empty';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { ListToolbar } from '../../../../shared/components/list-toolbar/list-toolbar';
import { datesSection, filteredList, optionsSection } from '../../../../shared/list/filtered-list';
import { REWARD_TYPE_LABEL } from '../../../../shared/models/rewards.models';

/** Reward distribution history: every welcome, birthday and campaign reward given. */
@Component({
  selector: 'bb-reward-history',
  imports: [
    TableLabels,DatePipe, ListToolbar, MatPaginatorModule, IconComponent, ListEmpty, PageHeader],
  templateUrl: './reward-history.html',
  styleUrl: './reward-history.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RewardHistoryPage {
  private readonly api = inject(AdminRewardsService);
  protected readonly typeLabel = REWARD_TYPE_LABEL;
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
}
