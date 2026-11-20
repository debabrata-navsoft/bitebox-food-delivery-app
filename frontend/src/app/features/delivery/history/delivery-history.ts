import { IconComponent, PaginationComponent } from 'nexprime';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RiderService } from '../../../core/services/order-management.service';
import { ListEmpty } from '../../../shared/components/list-empty/list-empty';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { OrderStatusChip } from '../../../shared/components/order-status-chip/order-status-chip';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { datesSection, filteredList, optionsSection } from '../../../shared/list/filtered-list';
import { InrPipe } from '../../../shared/pipes/money.pipes';

@Component({
  selector: 'bb-delivery-history',
  imports: [
    DatePipe,
    IconComponent,
    PaginationComponent,
    ListEmpty,
    ListToolbar,
    OrderStatusChip,
    PageHeader,
    InrPipe,
  ],
  templateUrl: './delivery-history.html',
  styleUrl: './delivery-history.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeliveryHistory {
  private readonly rider = inject(RiderService);

  /** Names of the restaurants on this page, for a chip whose counts haven't loaded. */
  private readonly restaurantNames = computed(
    () => new Map((this.list.data()?.items ?? []).map((o) => [o.restaurant, o.restaurantSnapshot.name])),
  );

  protected readonly filterSections = [
    optionsSection('status', 'Status', { delivered: 'Delivered', cancelled: 'Cancelled' }),
    // The restaurants this rider delivered for (the API's counts, with their names).
    optionsSection('restaurant', 'Restaurant', (id) => this.restaurantNames().get(id) ?? id),
    datesSection('placed', 'Order date'),
  ];

  protected readonly history = filteredList((query) => this.rider.history(query), {
    limit: 15,
    errorText: 'Could not load your deliveries.',
  });
  protected readonly list = this.history.list;
}
