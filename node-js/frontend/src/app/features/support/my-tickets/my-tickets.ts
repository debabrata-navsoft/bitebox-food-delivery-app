import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginatorModule } from '@angular/material/paginator';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from 'nexprime';
import { SupportService } from '../../../core/services/support.service';
import { ListEmpty } from '../../../shared/components/list-empty/list-empty';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { datesSection, filteredList, optionsSection } from '../../../shared/list/filtered-list';
import {
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
  TICKET_TYPE_LABEL,
} from '../../../shared/models/admin-roles.models';
import { openNewTicket } from '../new-ticket-dialog/new-ticket-dialog';
import { supportBase } from '../support-base';

/** A requester's ticket states: "Open" includes the ones waiting for their reply. */
const STATUS_FILTER_LABEL = {
  open: 'Open',
  waiting_for_response: 'Waiting for your reply',
  closed: 'Resolved or closed',
};

/** "Help & support" for customers, restaurants and riders: their tickets and a way to open one. */
@Component({
  selector: 'bb-my-tickets',
  imports: [
    DatePipe,
    RouterLink,
    ListToolbar,
    MatButtonModule,
    MatPaginatorModule,
    IconComponent,
    ListEmpty,
    PageHeader,
  ],
  templateUrl: './my-tickets.html',
  styleUrl: './my-tickets.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyTickets {
  private readonly api = inject(SupportService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  protected readonly base = supportBase();
  protected readonly statusLabel = TICKET_STATUS_LABEL;
  protected readonly statusTone = TICKET_STATUS_TONE;
  protected readonly typeLabel = TICKET_TYPE_LABEL;

  /** ?order=BB-… (from an order page) opens the form with the order filled in. */
  readonly order = input<string>();

  protected readonly filterSections = [
    optionsSection('status', 'Status', STATUS_FILTER_LABEL),
    optionsSection('type', 'About', TICKET_TYPE_LABEL),
    datesSection('created', 'Opened'),
  ];
  protected readonly ticketList = filteredList((query) => this.api.mine(query), {
    errorText: 'Could not load your tickets.',
  });
  protected readonly list = this.ticketList.list;

  constructor() {
    afterNextRender(() => {
      if (this.order()) this.create(this.order());
    });
  }

  protected create(orderNumber?: string): void {
    openNewTicket(this.dialog, orderNumber ? { orderNumber } : null).subscribe((ticket) => {
      if (ticket) void this.router.navigate([this.base.path(), ticket.id]);
    });
  }
}
