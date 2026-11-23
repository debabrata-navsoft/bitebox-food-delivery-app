import { CommissionRates } from './commission-rates/commission-rates';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconComponent } from 'nexprime';
import { Commission } from '../../../../core/models/admin-roles.models';
import { FinanceService } from '../../../../core/services/admin/finance.service';
import { DataTable, TableColumn } from '../../../../shared/components/data-table/data-table';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { StatTile } from '../../../../shared/components/stat-tile/stat-tile';
import { NP_FORM_FIELDS } from '../../../../shared/forms/np-form-fields';
import { periodReport } from '../../../../shared/list/period-report';
import { formatPaise } from '../../../../shared/pipes/money.pipes';

/** Commission rates and what they earned per restaurant over the period. */
@Component({
  selector: 'bb-commission',
  imports: [
    DataTable,
    IconComponent,
    NP_FORM_FIELDS,
    PageHeader,
    StatTile,
    CommissionRates,
  ],
  templateUrl: './commission.html',
  styleUrl: './commission.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommissionPage {
  private readonly api = inject(FinanceService);
  protected readonly report = periodReport(
    (days) => this.api.commission(days),
    'Could not load commission.',
  );
  protected readonly money = (paise: number) => formatPaise(paise) || '₹0';

  protected readonly columns: TableColumn<Commission['items'][number]>[] = [
    { label: 'Restaurant', value: (r) => r.name, strong: true },
    { label: 'Orders', value: (r) => r.orders, align: 'end' },
    { label: 'Food value', paise: (r) => r.foodPaise },
    { label: 'Commission', paise: (r) => r.commissionPaise },
    { label: "Restaurant's share", paise: (r) => r.restaurantPaise },
    { label: 'BiteBox net', paise: (r) => r.platformPaise, strong: true },
  ];
}
