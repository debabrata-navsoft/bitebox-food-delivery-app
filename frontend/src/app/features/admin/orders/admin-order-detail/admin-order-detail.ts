import { ButtonComponent, IconComponent } from 'nexprime';
import { DetailNav } from '../../../../shared/components/detail-nav/detail-nav';
import { pickRider } from '../assign-rider-dialog/assign-rider-dialog';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { EMPTY, Observable, catchError, switchMap, tap } from 'rxjs';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { liveRefresh } from '../../../../core/services/poll';
import { AuthService } from '../../../../core/auth/auth.service';
import { errorMessage } from '../../../../shared/utils/api-error';
import { NotificationService } from '../../../../core/services/notification.service';
import { AdminOrdersService } from '../../../../core/services/order-management.service';
import { BillSummary } from '../../../../shared/components/bill-summary/bill-summary';
import {
  ConfirmDialogData,
  confirmed,
} from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { OrderStatusChip } from '../../../../shared/components/order-status-chip/order-status-chip';
import { deliveryTracking } from '../../../../shared/components/tracking-map/delivery-tracking';
import { TrackingMap } from '../../../../shared/components/tracking-map/tracking-map';
import { VegBadge } from '../../../../shared/components/veg-badge/veg-badge';
import {
  ORDER_STATUS_LABEL,
  OrderStatus,
  VEHICLE_LABEL,
  customerStatusLabel,
} from '../../../../core/models/checkout.models';
import { AdminOrder, TRACKED_STATUSES } from '../../../../core/models/order-management.models';
import {
  DistancePipe,
  InrPipe,
  formatDistance,
  formatPaise,
} from '../../../../shared/pipes/money.pipes';
import { dateText } from '../../../../shared/utils/dates';
import {
  PAYMENT_STATUS_LABEL,
  PROVIDER_LABEL,
  REFUND_STATUS_LABEL,
  paymentTone,
} from '../../../../core/models/payment.models';
import { BbDialog } from '../../../../shared/dialog/bb-dialog';
import { DeliveryRangeService } from '../../../../core/services/delivery-range.service';

const CANCELLABLE: OrderStatus[] = [
  'pending',
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'assigned',
  'arrived_at_restaurant',
];

/** [label, value] pairs as a card's figures, leaving out those the order does not have. */
const facts = (pairs: [string, unknown][]) =>
  pairs.filter(([, value]) => !!value).map(([label, value]) => ({ label, value: String(value) }));

/** The order's journey as the tracker shows it; a step counts as reached at its first status. */
const STEPS: { label: string; icon: string; statuses: OrderStatus[] }[] = [
  { label: 'Placed', icon: 'receipt', statuses: ['pending'] },
  { label: 'Accepted', icon: 'circle-check', statuses: ['confirmed'] },
  { label: 'Preparing', icon: 'chef-hat', statuses: ['preparing'] },
  {
    label: 'Ready',
    icon: 'package',
    statuses: ['ready_for_pickup', 'assigned', 'arrived_at_restaurant'],
  },
  { label: 'On the way', icon: 'bike', statuses: ['picked_up', 'on_the_way'] },
  { label: 'Delivered', icon: 'house', statuses: ['delivered'] },
];

export interface JourneyStep {
  label: string;
  icon: string;
  at: string | null;
  state: 'done' | 'current' | 'todo' | 'stopped';
}

/** One order on its own page: parties, live map, items and bill, payment, history and the actions. */
@Component({
  selector: 'bb-admin-order-detail',
  imports: [
    DetailNav,
    DatePipe,
    DecimalPipe,
    ButtonComponent,
    IconComponent,
    BillSummary,
    OrderStatusChip,
    TrackingMap,
    VegBadge,
    InrPipe,
    DistancePipe,
    NgTemplateOutlet,
  ],
  templateUrl: './admin-order-detail.html',
  styleUrl: './admin-order-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminOrderDetail {
  /** The route's `:id`. */
  readonly id = input.required<string>();
  private readonly api = inject(AdminOrdersService);
  private readonly dialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);
  /** Support can read orders; only operations (and the super admin) cancel or unassign. */
  protected readonly canManage = inject(AuthService).can('orders:manage');

  protected readonly order = signal<AdminOrder | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly statusLabel = ORDER_STATUS_LABEL;
  protected readonly customerLabel = customerStatusLabel;
  protected readonly vehicleLabel = VEHICLE_LABEL;
  protected readonly refundLabel = REFUND_STATUS_LABEL;
  protected readonly paymentTone = paymentTone;
  protected readonly tracking = deliveryTracking(this.order);
  protected readonly range = inject(DeliveryRangeService);
  protected readonly onTheRoad = (o: AdminOrder) => TRACKED_STATUSES.includes(o.status);

  /** The tracker: steps done, the current one, those to come; a cancelled or rejected order
   * ends in a red stop after the last step it reached. */
  protected readonly journey = computed((): JourneyStep[] => {
    const o = this.order();
    if (!o) return [];
    const reached = (statuses: OrderStatus[]) =>
      o.statusHistory.find((h) => statuses.includes(h.status))?.at ?? null;
    const last = STEPS.reduce(
      (n, s, i) => (reached(s.statuses) || s.statuses.includes(o.status) ? i : n),
      0,
    );
    const stopped = o.status === 'cancelled' || o.status === 'rejected';
    const steps: JourneyStep[] = STEPS.map((s, i) => ({
      label: s.label,
      icon: s.icon,
      at: reached(s.statuses),
      state:
        i < last || (i === last && (stopped || o.status === 'delivered'))
          ? 'done'
          : i === last
            ? 'current'
            : 'todo',
    }));
    if (!stopped) return steps;
    return [
      ...steps.slice(0, last + 1),
      {
        label: o.status === 'rejected' ? 'Rejected' : 'Cancelled',
        icon: 'circle-x',
        at: o.cancellation?.at ?? o.statusHistory.at(-1)?.at ?? null,
        state: 'stopped',
      },
    ];
  });

  constructor() {
    // Live: the first request is the page load; then any event for this order (status change,
    // rider assigned...) or the slow poll on a visible tab refetches it, so the tracker,
    // badges, activity and actions follow along. Built here (it injects the realtime service),
    // started once the route's id is set and restarted if it changes.
    const live = liveRefresh(() => this.fetch(this.id()), {
      pollMs: 30_000,
      when: (e) => e.id === this.id(),
    });
    toObservable(this.id)
      .pipe(
        switchMap(() => live),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  private readonly dates = dateText();

  /** The payment badge: how it was paid and where the payment stands. */
  protected readonly pay = computed(() => {
    const o = this.order();
    if (!o) return null;
    const status = o.payment?.status ?? o.paymentStatus;
    return {
      via: o.payment
        ? PROVIDER_LABEL[o.payment.provider]
        : o.paymentMethod === 'online'
          ? 'Online'
          : 'Cash',
      label: PAYMENT_STATUS_LABEL[status] ?? status,
      tone: paymentTone(status),
    };
  });

  /** What an operations admin can do to the order now (none for support, or once it is over). */
  protected readonly actions = computed(() => {
    const o = this.order();
    if (!o || !this.canManage) return [];
    type Action = { label: string; icon: string; danger?: boolean; run: (o: AdminOrder) => void };
    const all: (Action | false)[] = [
      !!o.canAssign && { label: 'Assign rider', icon: 'bike', run: (x) => this.assign(x) },
      !!o.deliveryOtpPending && {
        label: 'New delivery code',
        icon: 'key-round',
        run: (x) => this.resetCode(x),
      },
      (o.status === 'assigned' || o.status === 'arrived_at_restaurant') && {
        label: 'Unassign rider',
        icon: 'user-x',
        run: (x) => this.unassign(x),
      },
      CANCELLABLE.includes(o.status) && {
        label: 'Cancel order',
        icon: 'circle-x',
        danger: true,
        run: (x) => this.cancel(x),
      },
    ];
    return all.filter((a): a is Action => !!a);
  });

  /** The Payment card's figures. */
  protected readonly paymentFacts = computed(() => {
    const o = this.order();
    const p = o?.payment;
    return facts([
      ['Method', o && (o.paymentMethod === 'online' ? 'Online' : 'Cash on delivery')],
      ['Provider', p && PROVIDER_LABEL[p.provider] + (p.simulated ? ' (test)' : '')],
      ['Amount', p && formatPaise(p.amountPaise)],
      ['Paid', p && (this.dates.day(p.paidAt, 'd MMM, h:mm a') || '—')],
      ['Refunded', p?.refundedPaise && formatPaise(p.refundedPaise)],
    ]);
  });

  /** The Delivery card's figures. */
  protected readonly deliveryFacts = computed(() => {
    const o = this.order();
    return facts([
      ['Distance', o && `${formatDistance(o.distanceMeters)} straight line`],
      ['Preparation', o?.prepMinutes && `${o.prepMinutes} min`],
      ['Ready by', o?.readyBy && this.dates.day(o.readyBy, 'h:mm a')],
      [
        'Delivery code',
        o?.deliveryOtpPending &&
          `Waiting${o.deliveryOtpAttempts ? ` · ${o.deliveryOtpAttempts} wrong tries` : ''}`,
      ],
    ]);
  });

  /** Loads the order (Retry, and after a failed action). */
  protected load(): void {
    this.fetch(this.id()).subscribe();
  }

  /** The order into `order`, or the error into `error` (it never fails, as live refresh needs). */
  private fetch(id: string): Observable<AdminOrder> {
    return this.api.get(id).pipe(
      tap((o) => {
        this.order.set(o);
        this.error.set(null);
      }),
      catchError((err: unknown) => {
        this.error.set(errorMessage(err, 'Could not load this order.'));
        return EMPTY;
      }),
    );
  }

  private cancel(o: AdminOrder): void {
    this.confirm(
      {
        title: `Cancel order ${o.orderNumber}?`,
        message:
          'The customer, restaurant and rider (if any) will see it as cancelled. This cannot be undone.',
        reasonLabel: 'Reason (shown to the customer)',
        confirmLabel: 'Cancel order',
        danger: true,
      },
      (reason) => this.api.cancel(o.id, reason!),
      'Order cancelled',
    );
  }

  private unassign(o: AdminOrder): void {
    this.confirm(
      {
        title: 'Unassign the rider?',
        message: `${o.rider?.name ?? 'The rider'} is released and the order is offered to another nearby rider.`,
        reasonLabel: 'Reason (for the order history)',
        confirmLabel: 'Unassign',
      },
      (reason) => this.api.unassign(o.id, reason),
      'Rider unassigned. Finding another rider…',
    );
  }

  private assign(o: AdminOrder): void {
    pickRider(this.dialog, o).subscribe((riderId) =>
      this.run(this.api.assign(o.id, riderId), 'Rider assigned'),
    );
  }

  private resetCode(o: AdminOrder): void {
    this.confirm(
      {
        title: 'Send a new delivery code?',
        message: `The customer gets a new 4-digit code for ${o.orderNumber}, and the rider can try again${
          o.deliveryOtpAttempts ? ` (${o.deliveryOtpAttempts} wrong so far)` : ''
        }.`,
        confirmLabel: 'Send new code',
      },
      () => this.api.resetDeliveryCode(o.id),
      'New delivery code sent to the customer',
    );
  }

  private confirm(
    data: ConfirmDialogData,
    action: (reason?: string) => Observable<AdminOrder>,
    message: string,
  ): void {
    confirmed(this.dialog, data, '460px').subscribe((result) =>
      this.run(action(typeof result === 'string' ? result : undefined), message),
    );
  }

  /** Runs an order action: busy while it runs, then the updated order, or the error and a reload. */
  private run(request: Observable<AdminOrder>, message: string): void {
    this.busy.set(true);
    request.subscribe({
      next: (o) => {
        this.order.set(o);
        this.busy.set(false);
        this.notify.success(message);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.notify.error(errorMessage(err));
        this.load();
      },
    });
  }
}
