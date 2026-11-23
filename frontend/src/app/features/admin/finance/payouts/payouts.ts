import { TableLabels } from '../../../../shared/directives/table-labels';
import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ButtonComponent, IconComponent, PaginationComponent } from 'nexprime';
import { Observable } from 'rxjs';
import { FinanceService } from '../../../../core/services/admin/finance.service';
import { errorMessage, resourceError } from '../../../../shared/utils/api-error';
import { NotificationService } from '../../../../core/services/notification.service';
import { confirmed } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { EmptyState } from '../../../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { ListEmpty } from '../../../../shared/components/list-empty/list-empty';
import { ListToolbar } from '../../../../shared/components/list-toolbar/list-toolbar';
import { datesSection, filteredList, optionsSection } from '../../../../shared/list/filtered-list';
import {
  PAYOUT_STATUS_LABEL,
  PAYOUT_STATUS_TONE,
  Payout,
  PayoutDue,
  PayoutType,
} from '../../../../core/models/admin-roles.models';
import { InrPipe, formatPaise } from '../../../../shared/pipes/money.pipes';
import { BbDialog } from '../../../../shared/dialog/bb-dialog';
import { TabStrip } from '../../../../shared/components/tab-strip/tab-strip';

const COPY: Record<PayoutType, { title: string; subtitle: string; payee: string }> = {
  restaurant: {
    title: 'Restaurant payouts',
    subtitle: 'Each restaurant earns its share of delivered orders (food value minus commission).',
    payee: 'Restaurant',
  },
  rider: {
    title: 'Delivery partner payments',
    subtitle: 'Each rider earns a base amount plus a per-km rate for every delivery.',
    payee: 'Delivery partner',
  },
};

@Component({
  selector: 'bb-payouts',
  imports: [
    TableLabels,
    DatePipe,
    ListToolbar,
    ButtonComponent,
    PaginationComponent,
    IconComponent,
    EmptyState,
    ListEmpty,
    PageHeader,
    InrPipe,
    TabStrip,
  ],
  templateUrl: './payouts.html',
  styleUrl: './payouts.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PayoutsPage implements OnInit {
  private readonly api = inject(FinanceService);
  private readonly dialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);

  /** Route parameter: restaurant or rider. */
  readonly type = input<PayoutType>('restaurant');
  protected readonly copy = computed(() => COPY[this.type()] ?? COPY.restaurant);
  protected readonly statusLabel = PAYOUT_STATUS_LABEL;
  protected readonly statusTone = PAYOUT_STATUS_TONE;
  protected readonly busy = signal<string | null>(null);

  protected readonly due = rxResource({
    params: () => this.type(),
    stream: ({ params }) => this.api.due(params),
  });
  protected readonly dueError = resourceError(this.due, 'Could not load what is owed.');
  /** The payees owed now ([] while loading). */
  protected readonly owed = computed(() => (this.due.hasValue() ? this.due.value() : []));
  protected readonly dueTotal = computed(() => this.owed().reduce((n, r) => n + r.amountPaise, 0));

  /** Owed now (with the number of payees waiting) and Payout history; a new page starts on Owed now. */
  protected readonly tabs = computed(() => [
    { id: 'due', label: 'Owed now', content: '', badge: this.owed().length || undefined },
    { id: 'history', label: 'Payout history', content: '' },
  ]);
  protected readonly tab = linkedSignal({ source: this.type, computation: () => 'due' });

  /** The payee section follows the page: restaurants, or riders (user ids), from the API's counts. */
  protected readonly filterSections = computed(() => [
    optionsSection('status', 'Status', PAYOUT_STATUS_LABEL),
    this.type() === 'rider'
      ? optionsSection('rider', 'Delivery partner')
      : optionsSection('restaurant', 'Restaurant'),
    datesSection('created', 'Created'),
  ]);
  protected readonly payouts = filteredList((query) => this.api.payouts(query), {
    errorText: 'Could not load payouts.',
    extra: () => ({ type: this.type() }),
    lazy: true,
  });
  protected readonly history = this.payouts.list;

  constructor() {
    // Restaurants and riders don't mix: a switch between the two pages starts with no filters.
    effect(() => {
      this.type();
      untracked(() => this.payouts.clear());
    });
  }

  ngOnInit(): void {
    this.history.load(1);
  }

  protected payOut(row: PayoutDue): void {
    confirmed(this.dialog, {
      title: `Pay ${row.name} ${formatPaise(row.amountPaise)}?`,
      message: `Creates a payout for ${row.orders} delivered order${row.orders === 1 ? '' : 's'}. Send the money, then mark the payout as paid with the transfer reference.`,
      confirmLabel: 'Create payout',
    }).subscribe(() =>
      this.run(row.payeeId, this.api.createPayout(this.type(), row.payeeId), 'Payout created'),
    );
  }

  protected markPaid(p: Payout): void {
    confirmed(this.dialog, {
      title: `Mark ${formatPaise(p.amountPaise)} to ${p.payeeName} as paid?`,
      message: 'Enter the bank or UPI transfer reference so the payment can be traced.',
      confirmLabel: 'Mark as paid',
      reasonLabel: 'Transfer reference',
      reasonMax: 120,
    }).subscribe((reference) =>
      this.run(p.id, this.api.markPaid(p.id, String(reference)), 'Payout marked as paid'),
    );
  }

  protected statement(p: Payout): void {
    this.api.statement(p.id).catch((err: Error) => this.notify.error(err.message));
  }

  protected cancel(p: Payout): void {
    confirmed(this.dialog, {
      title: `Cancel this payout to ${p.payeeName}?`,
      message: 'Its orders go back to "owed" so they can be paid out again.',
      confirmLabel: 'Cancel payout',
      danger: true,
      reasonLabel: 'Why',
    }).subscribe((note) =>
      this.run(p.id, this.api.cancelPayout(p.id, String(note)), 'Payout cancelled'),
    );
  }

  private run(id: string, action: Observable<Payout>, done: string): void {
    this.busy.set(id);
    action.subscribe({
      next: () => {
        this.busy.set(null);
        this.notify.success(done);
        this.due.reload();
        this.history.reload();
      },
      error: (err: unknown) => {
        this.busy.set(null);
        this.notify.error(errorMessage(err));
        this.due.reload();
      },
    });
  }
}
