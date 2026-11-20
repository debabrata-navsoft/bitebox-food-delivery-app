import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { ButtonComponent, ButtonToggleComponent, PaginationComponent } from 'nexprime';
import { NotificationService } from '../../../../core/services/notification.service';
import { PartnerFinanceService } from '../../../../core/services/partner-finance.service';
import { EarningsScope } from '../../../../core/services/reports.service';
import { ListEmpty } from '../../list-empty/list-empty';
import { ListToolbar } from '../../list-toolbar/list-toolbar';
import { datesSection, filteredList, optionsSection } from '../../../list/filtered-list';
import { PAYOUT_STATUS_TONE, Payout } from '../../../../core/models/admin-roles.models';
import { InrPipe } from '../../../pipes/money.pipes';

type View = 'settlements' | 'payouts';
// Partner wording; the tones match the admin payouts screen.
const PAYOUT_LABEL: Record<Payout['status'], string> = {
  pending: 'Being paid',
  paid: 'Paid',
  cancelled: 'Cancelled',
};
// A settlement's payout state (a cancelled payout releases its orders, so they are due again).
const SETTLEMENT_LABEL = { due: 'Due', pending: PAYOUT_LABEL.pending, paid: PAYOUT_LABEL.paid };

/**
 * A partner's settlement history (what each delivered order paid them, and whether it has been
 * paid out) and their payouts, with a PDF statement for each payout.
 */
@Component({
  selector: 'bb-settlement-history',
  imports: [
    DatePipe,
    ButtonComponent,
    ButtonToggleComponent,
    PaginationComponent,
    ListEmpty,
    InrPipe,
    ListToolbar,
  ],
  templateUrl: './settlement-history.html',
  styleUrl: './settlement-history.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettlementHistory implements OnInit {
  private readonly api = inject(PartnerFinanceService);
  private readonly notify = inject(NotificationService);
  readonly scope = input<EarningsScope>('restaurant');

  protected readonly view = signal<View>('settlements');
  protected readonly views = [
    { value: 'settlements' as const, label: 'By order' },
    { value: 'payouts' as const, label: 'Payouts' },
  ];
  protected readonly payoutLabel = PAYOUT_LABEL;
  protected readonly payoutTone = PAYOUT_STATUS_TONE;

  protected readonly settlementSections = [
    optionsSection('status', 'Payout', SETTLEMENT_LABEL),
    datesSection('settled', 'Settled'),
  ];
  protected readonly payoutSections = [
    optionsSection('status', 'Status', PAYOUT_LABEL),
    datesSection('created', 'Created'),
  ];

  // Lazy: the `scope` input is only set after construction (loaded in ngOnInit).
  protected readonly settlementList = filteredList((query) => this.api.settlements(this.scope(), query), {
    limit: 10,
    lazy: true,
    errorText: 'Could not load your settlements.',
  });
  protected readonly settlements = this.settlementList.list;
  protected readonly payoutList = filteredList((query) => this.api.payouts(this.scope(), query), {
    limit: 10,
    lazy: true,
    errorText: 'Could not load your payouts.',
  });
  protected readonly payouts = this.payoutList.list;

  ngOnInit(): void {
    this.settlements.load(1);
  }

  protected select(value: unknown): void {
    if (value !== 'settlements' && value !== 'payouts') return;
    this.view.set(value);
    if (value === 'payouts' && !this.payouts.data()) this.payouts.load(1);
  }

  protected statement(p: Payout): void {
    this.api.statement(this.scope(), p.id).catch((err: Error) => this.notify.error(err.message));
  }
}
