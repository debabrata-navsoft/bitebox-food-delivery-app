import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { DatePipe, TitleCasePipe, formatDate } from '@angular/common';
import { ConfettiComponent, TimelineComponent, type TimelineEvent } from 'nexprime';
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

/** The happy-path journey shown as a progress tracker, with a NexPrime icon per step. */
const JOURNEY: { status: OrderStatus; icon: string }[] = [
  { status: 'pending', icon: 'receipt' },
  { status: 'confirmed', icon: 'circle-check' },
  { status: 'preparing', icon: 'chef-hat' },
  { status: 'ready_for_pickup', icon: 'package' },
  { status: 'picked_up', icon: 'bike' },
  { status: 'on_the_way', icon: 'navigation' },
  { status: 'delivered', icon: 'house' },
];

@Component({
  selector: 'bb-order-detail',
  imports: [
    DatePipe,
    TitleCasePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    BillSummary,
    EmptyState,
    VegBadge,
    InrPipe,
    TimelineComponent,
    ConfettiComponent,
  ],
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

  private readonly locale = inject(LOCALE_ID);
  private readonly confetti = viewChild(ConfettiComponent);
  private celebrated = false;

  /** Index of the current step in JOURNEY ("assigned" shows as ready for pickup). */
  protected readonly activeStep = computed(() => {
    const status = this.order()?.status;
    if (!status) return -1;
    return JOURNEY.findIndex((s) => s.status === (status === 'assigned' ? 'ready_for_pickup' : status));
  });

  /** Steps for <np-timeline>: label, time reached (if any) and icon. */
  protected readonly timeline = computed<TimelineEvent[]>(() => {
    const order = this.order();
    if (!order) return [];
    return JOURNEY.map(({ status, icon }) => {
      const at = order.statusHistory.find((h) => h.status === status)?.at;
      return { status: ORDER_STATUS_LABEL[status], date: at ? formatDate(at, 'shortTime', this.locale) : '', icon };
    });
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

  /** Confetti burst once, right after checkout (?placed=1). */
  private celebrate(): void {
    if (!this.placed() || this.celebrated) return;
    this.celebrated = true;
    // Wait a frame so the banner (and its canvas) is rendered and sized.
    setTimeout(() => this.confetti()?.fire(), 150);
  }

  protected load(id = this.id()): void {
    this.loading.set(true);
    this.error.set(null);
    this.orders.get(id).subscribe({
      next: (order) => {
        this.order.set(order);
        this.loading.set(false);
        this.celebrate();
      },
      error: (err: unknown) => {
        if (err instanceof HttpErrorResponse && (err.status === 404 || err.status === 422)) this.notFound.set(true);
        else this.error.set(errorMessage(err));
        this.loading.set(false);
      },
    });
  }
}
