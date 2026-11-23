import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { IconComponent } from 'nexprime';
import { AdminRewardsService } from '../../../../core/services/admin/admin-rewards.service';
import { DataTable, TableColumn } from '../../../../shared/components/data-table/data-table';
import { DailyChart } from '../../../../shared/components/daily-chart/daily-chart';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { StatTile } from '../../../../shared/components/stat-tile/stat-tile';
import { NP_FORM_FIELDS } from '../../../../shared/forms/np-form-fields';
import { periodReport } from '../../../../shared/list/period-report';
import { CAMPAIGN_STATUS_LABEL, RewardsReport } from '../../../../core/models/rewards.models';
import { formatPaise } from '../../../../shared/pipes/money.pipes';
import { formatCount } from '../../../../shared/utils/numbers';

/** Coins & Rewards reports: issued, redeemed, liability, programmes and suspicious activity. */
@Component({
  selector: 'bb-rewards-overview',
  imports: [
    RouterLink, MatButtonModule, IconComponent, NP_FORM_FIELDS, PageHeader, StatTile, DailyChart, DataTable],
  templateUrl: './rewards-overview.html',
  styleUrl: './rewards-overview.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RewardsOverviewPage {
  private readonly api = inject(AdminRewardsService);
  protected readonly report = periodReport((days) => this.api.reports(days), 'Could not load rewards reports.');
  protected readonly money = formatPaise;
  protected readonly count = formatCount;
  protected readonly coins = (n: number) => `${formatCount(n)} coins`;

  protected readonly columns: TableColumn<RewardsReport['campaigns']['top'][number]>[] = [
    { label: 'Campaign', value: (c) => c.name },
    { label: 'Status', value: (c) => CAMPAIGN_STATUS_LABEL[c.status] },
    { label: 'Claims', value: (c) => c.claims, align: 'end' },
    { label: 'Coins', value: (c) => formatCount(c.coins), align: 'end' },
  ];

  private readonly daily = computed(() => this.report.data()?.daily ?? []);
  protected readonly dates = computed(() => this.daily().map((d) => d.date));
  protected readonly series = computed(() => [
    { label: 'Issued', values: this.daily().map((d) => d.issued) },
    { label: 'Redeemed', values: this.daily().map((d) => d.redeemed) },
  ]);

  /** Where the period's coins came from. */
  protected readonly sources = computed(() => {
    const p = this.report.data()?.period;
    if (!p) return [];
    const rows = [
      { label: 'Orders', coins: p.orderRewards },
      { label: 'Reviews', coins: p.reviewRewards },
      { label: 'Referrals', coins: p.referralRewards },
      { label: 'Welcome', coins: p.welcomeRewards },
      { label: 'Birthdays', coins: p.birthdayRewards },
      { label: 'Festivals & promotions', coins: p.promotionalRewards },
    ];
    const total = rows.reduce((n, r) => n + r.coins, 0) || 1;
    return rows.map((r) => ({ ...r, share: r.coins / total }));
  });
}
