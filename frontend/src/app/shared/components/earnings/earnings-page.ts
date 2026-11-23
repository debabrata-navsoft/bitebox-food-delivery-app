import { IconComponent } from 'nexprime';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { EarningsScope, ReportsService } from '../../../core/services/reports.service';
import { DailyChart } from '../daily-chart/daily-chart';
import { EmptyState } from '../empty-state/empty-state';
import { PageHeader } from '../page-header/page-header';
import { StatTile } from '../stat-tile/stat-tile';
import { NP_FORM_FIELDS } from '../../forms/np-form-fields';
import { periodReport } from '../../list/period-report';
import { InrPipe, formatDistance, formatPaise } from '../../pipes/money.pipes';
import { SettlementHistory } from './settlement-history/settlement-history';
import { TabStrip } from '../tab-strip/tab-strip';

@Component({
  selector: 'bb-earnings-page',
  imports: [
    DatePipe,
    NP_FORM_FIELDS,
    IconComponent,
    DailyChart,
    EmptyState,
    PageHeader,
    StatTile,
    InrPipe,
    SettlementHistory,
    TabStrip,
  ],
  templateUrl: './earnings-page.html',
  styleUrl: './earnings-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EarningsPage {
  private readonly api = inject(ReportsService);
  readonly scope = input<EarningsScope>('restaurant');

  protected readonly report = periodReport(
    (days) => this.api.earnings(this.scope(), days),
    'Could not load your earnings.',
  );
  protected readonly tabs = [
    { id: 'earnings', label: 'Earnings', content: '' },
    { id: 'settlements', label: 'Settlements and payouts', content: '' },
  ];
  protected readonly tab = signal('earnings');
  protected readonly formatPaise = formatPaise;
  protected readonly distance = formatDistance;

  protected readonly rider = computed(() => this.scope() === 'rider');
  protected readonly dates = computed(() => this.report.data()?.daily.map((d) => d.date) ?? []);
  protected readonly series = computed(() => [
    { label: 'Earnings', values: this.report.data()?.daily.map((d) => d.earningsPaise) ?? [] },
  ]);
  protected readonly perOrder = computed(() => {
    const t = this.report.data()?.totals;
    return t?.orders ? formatPaise(Math.round(t.earningsPaise / t.orders)) : '–';
  });
}
