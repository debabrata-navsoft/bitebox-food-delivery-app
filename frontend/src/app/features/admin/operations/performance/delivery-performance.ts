import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IconComponent } from 'nexprime';
import { DeliveryPerformance } from '../../../../core/models/admin-roles.models';
import { OperationsService } from '../../../../core/services/admin/operations.service';
import { DataTable, TableColumn } from '../../../../shared/components/data-table/data-table';
import { DailyChart } from '../../../../shared/components/daily-chart/daily-chart';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { StatTile } from '../../../../shared/components/stat-tile/stat-tile';
import { NP_FORM_FIELDS } from '../../../../shared/forms/np-form-fields';
import { periodReport } from '../../../../shared/list/period-report';
import { formatDistance } from '../../../../shared/pipes/money.pipes';

const minutes = (n: number | null | undefined) => (n == null ? '–' : `${n} min`);

/** Operations reports: how fast orders get cooked and delivered, by day and by rider. */
@Component({
  selector: 'bb-delivery-performance',
  imports: [IconComponent, NP_FORM_FIELDS, PageHeader, StatTile, DailyChart, DataTable],
  templateUrl: './delivery-performance.html',
  styleUrl: './delivery-performance.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeliveryPerformancePage {
  private readonly api = inject(OperationsService);
  protected readonly report = periodReport(
    (days) => this.api.performance(days),
    'Could not load delivery performance.',
  );
  protected readonly minutes = minutes;
  protected readonly count = String;

  protected readonly riderColumns: TableColumn<DeliveryPerformance['topRiders'][number]>[] = [
    { label: 'Rider', value: (r) => r.name, strong: true },
    { label: 'Deliveries', value: (r) => r.deliveries, align: 'end' },
    { label: 'Average ride', value: (r) => minutes(r.avgRideMinutes), align: 'end' },
    {
      label: 'Distance (straight line)',
      value: (r) => formatDistance(r.distanceMeters),
      align: 'end',
    },
  ];

  private readonly daily = computed(() => this.report.data()?.daily ?? []);
  protected readonly dates = computed(() => this.daily().map((d) => d.date));
  protected readonly deliveredSeries = computed(() => [
    { label: 'Delivered', values: this.daily().map((d) => d.delivered) },
  ]);
  protected readonly minutesSeries = computed(() => [
    { label: 'Average minutes', values: this.daily().map((d) => d.avgMinutes) },
  ]);
}
