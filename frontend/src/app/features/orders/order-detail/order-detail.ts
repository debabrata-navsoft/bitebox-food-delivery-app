import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { errorMessage } from '../../../core/services/api-error';
import { OrderService } from '../../../core/services/checkout-api.service';
import { BillSummary } from '../../../shared/components/bill-summary/bill-summary';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { VegBadge } from '../../../shared/components/veg-badge/veg-badge';
import { ORDER_STATUS_LABEL, Order, OrderStatus } from '../../../shared/models/checkout.models';
import { InrPipe } from '../../../shared/pipes/money.pipes';

/** The happy-path journey shown as a progress tracker. */
const JOURNEY: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up', 'on_the_way', 'delivered'];

@Component({
  selector: 'bb-order-detail',
  imports: [DatePipe, TitleCasePipe, RouterLink, MatButtonModule, MatIconModule, BillSummary, EmptyState, VegBadge, InrPipe],
  templateUrl: './order-detail.html',
  styleUrl: './order-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderDetail {
  private readonly orders = inject(OrderService);

  readonly id = input.required<string>();
  /** ?placed=1 right after checkout. */
  readonly placed = input<string>();

  protected readonly order = signal<Order | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly statusLabel = ORDER_STATUS_LABEL;

  protected readonly steps = computed(() => {
    const order = this.order();
    if (!order) return [];
    const current = JOURNEY.indexOf(order.status === 'assigned' ? 'ready_for_pickup' : order.status);
    return JOURNEY.map((status, index) => ({
      status,
      label: ORDER_STATUS_LABEL[status],
      state: index < current ? 'done' : index === current ? 'current' : 'todo',
      at: order.statusHistory.find((h) => h.status === status)?.at,
    }));
  });
  protected readonly ended = computed(() => {
    const status = this.order()?.status;
    return status === 'cancelled' || status === 'rejected';
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this.load(id));
    });
  }

  protected load(id = this.id()): void {
    this.loading.set(true);
    this.error.set(null);
    this.orders.get(id).subscribe({
      next: (order) => {
        this.order.set(order);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        if (err instanceof HttpErrorResponse && (err.status === 404 || err.status === 422)) this.notFound.set(true);
        else this.error.set(errorMessage(err));
        this.loading.set(false);
      },
    });
  }
}
