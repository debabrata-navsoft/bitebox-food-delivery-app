import { TableLabels } from '../../../../shared/directives/table-labels';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import {
  ButtonComponent,
  IconComponent,
  MenuComponent,
  PaginationComponent,
  type MenuItem,
} from 'nexprime';
import { COMPACT_MENU_WIDTH, toggleEndAligned } from '../../../../shared/utils/end-aligned-menu';
import { filter, switchMap } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { AdminRewardsService } from '../../../../core/services/admin/admin-rewards.service';
import { errorMessage } from '../../../../shared/utils/api-error';
import { NotificationService } from '../../../../core/services/notification.service';
import { confirmed } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { ListEmpty } from '../../../../shared/components/list-empty/list-empty';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { ListToolbar } from '../../../../shared/components/list-toolbar/list-toolbar';
import { datesSection, filteredList, optionsSection } from '../../../../shared/list/filtered-list';
import {
  AdminCampaign,
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_TONE,
  CAMPAIGN_TYPE_LABEL,
  CUSTOMER_GROUP_LABEL,
  CampaignStatus,
} from '../../../../core/models/rewards.models';
import { CampaignDetailDialog } from '../campaign-detail-dialog/campaign-detail-dialog';
import { CampaignFormDialog } from '../campaign-form-dialog/campaign-form-dialog';
import { BbDialog } from '../../../../shared/dialog/bb-dialog';

type Action = 'activate' | 'pause' | 'end';

/** Festival and promotional campaigns: create, schedule, pause, end and follow them. */
@Component({
  selector: 'bb-reward-campaigns',
  imports: [
    TableLabels,DatePipe, ListToolbar, ButtonComponent, MenuComponent, PaginationComponent, IconComponent, ListEmpty, PageHeader],
  templateUrl: './reward-campaigns.html',
  styleUrl: './reward-campaigns.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RewardCampaignsPage {
  private readonly api = inject(AdminRewardsService);
  private readonly dialog = inject(MatDialog);
  private readonly bbDialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);
  protected readonly canManage = inject(AuthService).can('rewards:manage');
  protected readonly statusLabel = CAMPAIGN_STATUS_LABEL;
  protected readonly statusTone = CAMPAIGN_STATUS_TONE;
  protected readonly typeLabel = CAMPAIGN_TYPE_LABEL;
  protected readonly busy = signal<string | null>(null);

  protected readonly filterSections = [
    optionsSection('status', 'Status', CAMPAIGN_STATUS_LABEL),
    optionsSection('type', 'Type', CAMPAIGN_TYPE_LABEL),
    optionsSection('trigger', 'How customers get it', { CLAIM: 'Claimed', ORDER: 'On orders' }),
    optionsSection('customerGroup', 'Customers', CUSTOMER_GROUP_LABEL),
    datesSection('runs', 'Runs'), // campaigns running on any day of the range
  ];

  protected readonly campaigns = filteredList((query) => this.api.campaigns(query), {
    errorText: 'Could not load campaigns.',
  });
  protected readonly list = this.campaigns.list;

  protected actions(c: AdminCampaign): Action[] {
    const moves: Record<CampaignStatus, Action[]> = {
      DRAFT: ['activate', 'end'],
      SCHEDULED: ['pause', 'end'],
      ACTIVE: ['pause', 'end'],
      PAUSED: ['activate', 'end'],
      EXPIRED: [],
      COMPLETED: [],
    };
    return moves[c.status];
  }

  protected readonly actionLabel: Record<Action, string> = { activate: 'Activate', pause: 'Pause', end: 'End now' };

  protected readonly toggleMenu = (menu: MenuComponent, event: Event) =>
    toggleEndAligned(menu, event, COMPACT_MENU_WIDTH);

  /** Each campaign's actions menu (built once per page of results). */
  protected readonly menus = computed(
    () =>
      new Map<string, MenuItem[]>(
        (this.list.data()?.items ?? []).map((c) => [
          c.id,
          [
            ...(c.status !== 'EXPIRED' && c.status !== 'COMPLETED'
              ? [{ label: 'Edit', icon: 'pencil', command: () => this.open(c) }]
              : []),
            ...this.actions(c).map((a) => ({
              label: this.actionLabel[a],
              icon: a === 'activate' ? 'play' : a === 'pause' ? 'pause' : 'square',
              command: () => this.act(c, a),
            })),
            { label: 'Performance', icon: 'chart-column', command: () => this.details(c) },
          ],
        ]),
      ),
  );

  protected open(campaign?: AdminCampaign): void {
    this.dialog
      .open<CampaignFormDialog, AdminCampaign | null, AdminCampaign>(CampaignFormDialog, {
        data: campaign ?? null,
        width: '620px',
        maxWidth: '95vw',
      })
      .afterClosed()
      .pipe(filter(Boolean))
      .subscribe(() => {
        this.notify.success(campaign ? 'Campaign saved' : 'Draft created');
        this.list.reload();
      });
  }

  protected details(c: AdminCampaign): void {
    this.dialog.open(CampaignDetailDialog, { data: c.id, width: '680px', maxWidth: '95vw' });
  }

  protected act(c: AdminCampaign, action: Action): void {
    const messages: Record<Action, string> = {
      activate:
        new Date(c.startAt).getTime() > Date.now()
          ? `It will start on ${new Date(c.startAt).toLocaleString('en-IN')}.`
          : 'Customers can get it right away.',
      pause: 'Customers cannot get it until you activate it again.',
      end: 'It stops for good. Rewards already given are kept.',
    };
    confirmed(this.bbDialog, {
      title: `${this.actionLabel[action]} “${c.name}”?`,
      message: messages[action],
      confirmLabel: this.actionLabel[action],
      danger: action === 'end',
    })
      .pipe(
        switchMap(() => {
          this.busy.set(c.id);
          return this.api.setCampaignStatus(c.id, action);
        }),
      )
      .subscribe({
        next: (updated) => {
          this.busy.set(null);
          this.notify.success(`Campaign ${this.statusLabel[updated.status].toLowerCase()}`);
          this.list.reload();
        },
        error: (err: unknown) => {
          this.busy.set(null);
          this.notify.error(errorMessage(err));
        },
      });
  }
}
