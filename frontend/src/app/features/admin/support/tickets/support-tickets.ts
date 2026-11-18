import { TableLabels } from '../../../../shared/list/table-labels';
import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { MatPaginatorModule } from '@angular/material/paginator';
import { Router } from '@angular/router';
import { IconComponent } from 'nexprime';
import { SupportDeskService } from '../../../../core/services/support.service';
import { ListEmpty } from '../../../../shared/components/list-empty/list-empty';
import { ListToolbar } from '../../../../shared/components/list-toolbar/list-toolbar';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { datesSection, filteredList, optionsSection } from '../../../../shared/list/filtered-list';
import {
  REQUESTER_LABEL,
  TICKET_PRIORITY_LABEL,
  TICKET_PRIORITY_TONE,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
  TICKET_TYPE_LABEL,
  TicketQuery,
} from '../../../../shared/models/admin-roles.models';

type View = 'all' | 'customer' | 'restaurant' | 'delivery' | 'refunds' | 'mine' | 'unassigned';

/** Each queue in the sidebar is the same list with a fixed filter. */
const VIEWS: Record<View, { title: string; subtitle: string; query: TicketQuery }> = {
  all: { title: 'All support tickets', subtitle: 'Every ticket, most recent activity first.', query: {} },
  customer: {
    title: 'Customer complaints',
    subtitle: 'Tickets raised by customers.',
    query: { requesterRole: 'customer' },
  },
  restaurant: {
    title: 'Restaurant complaints',
    subtitle: 'Tickets raised by restaurant partners.',
    query: { requesterRole: 'restaurant' },
  },
  delivery: {
    title: 'Delivery partner complaints',
    subtitle: 'Tickets raised by riders.',
    query: { requesterRole: 'delivery' },
  },
  refunds: {
    title: 'Refund requests',
    subtitle: 'Refund tickets. Escalate the ones finance needs to act on.',
    query: { type: 'refund' },
  },
  mine: { title: 'My tickets', subtitle: 'Tickets assigned to you.', query: { assignee: 'me' } },
  unassigned: {
    title: 'Not assigned',
    subtitle: 'Nobody owns these yet. Reply to one to take it.',
    query: { assignee: 'unassigned' },
  },
};

@Component({
  selector: 'bb-support-tickets',
  imports: [TableLabels, DatePipe, ListToolbar, MatPaginatorModule, IconComponent, ListEmpty, PageHeader],
  templateUrl: './support-tickets.html',
  styleUrl: './support-tickets.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportTickets implements OnInit {
  private readonly api = inject(SupportDeskService);
  private readonly router = inject(Router);

  /** Route parameter. */
  readonly view = input<View>('all');
  protected readonly config = computed(() => VIEWS[this.view()] ?? VIEWS.all);

  protected readonly statusLabel = TICKET_STATUS_LABEL;
  protected readonly statusTone = TICKET_STATUS_TONE;
  protected readonly priorityLabel = TICKET_PRIORITY_LABEL;
  protected readonly priorityTone = TICKET_PRIORITY_TONE;
  protected readonly typeLabel = TICKET_TYPE_LABEL;
  protected readonly requesterLabel = REQUESTER_LABEL;

  /** The panel leaves out what the view already fixes (who raised it, the type, the assignee). */
  protected readonly filterSections = computed(() => {
    const fixed = this.config().query;
    return [
      optionsSection('status', 'Status', TICKET_STATUS_LABEL),
      optionsSection('priority', 'Priority', TICKET_PRIORITY_LABEL),
      ...(fixed.type ? [] : [optionsSection('type', 'Type', TICKET_TYPE_LABEL)]),
      ...(fixed.requesterRole ? [] : [optionsSection('requesterRole', 'Raised by', REQUESTER_LABEL)]),
      // "Not assigned" and the admins with tickets (names from the API's counts).
      ...(fixed.assignee ? [] : [optionsSection('assignee', 'Assigned to')]),
      datesSection('created', 'Created'),
    ];
  });

  protected readonly tickets = filteredList((query) => this.api.list(query), {
    errorText: 'Could not load tickets.',
    extra: () => ({ ...this.config().query }),
    pollMs: 60_000,
    when: () => false, // tickets don't change with order events: the timed poll only
    lazy: true,
  });
  protected readonly list = this.tickets.list;

  constructor() {
    // Each queue starts on all its tickets, with no search or filters.
    effect(() => {
      this.view();
      untracked(() => this.tickets.clear());
    });
  }

  ngOnInit(): void {
    this.list.load(1);
  }

  protected open(id: string): void {
    void this.router.navigate(['/admin/support/ticket', id]);
  }
}
