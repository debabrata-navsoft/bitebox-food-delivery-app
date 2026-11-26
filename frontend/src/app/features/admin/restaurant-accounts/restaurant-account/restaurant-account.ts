import { DatePipe, NgTemplateOutlet, TitleCasePipe } from '@angular/common';
import { DetailNav } from '../../../../shared/components/detail-nav/detail-nav';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IconComponent } from 'nexprime';
import { TabStrip } from '../../../../shared/components/tab-strip/tab-strip';
import { Observable } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { AdminRestaurantAccountsService } from '../../../../core/services/admin/admin-restaurant-accounts.service';
import { AdminUsersService } from '../../../../core/services/admin/admin-users.service';
import { errorMessage } from '../../../../shared/utils/api-error';
import { NotificationService } from '../../../../core/services/notification.service';
import { openAccountStatus } from '../../../../shared/components/account-status-dialog/account-status-dialog';
import { confirmed } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { KycReview } from '../../../../shared/components/kyc/kyc-review/kyc-review';
import { RecordTable } from '../../../../shared/components/record-table/record-table';
import { StatTile } from '../../../../shared/components/stat-tile/stat-tile';
import { loaded } from '../../../../shared/coupons/coupon-list';
import { BbDialog } from '../../../../shared/dialog/bb-dialog';
import { Restaurant, WEEK_DAYS } from '../../../../core/models/catalog.models';
import { USER_STATUS_META } from '../../../../core/models/user.models';
import { kindLabel } from '../../../../core/models/kyc.models';
import { ClockTimePipe } from '../../../../shared/pipes/clock-time.pipe';
import { InrPipe, formatPaise } from '../../../../shared/pipes/money.pipes';
import { InfoRow, InfoRows } from '../../../../shared/components/info-rows/info-rows';
import { PersonInfo } from '../../../../shared/components/person-info/person-info';
import { formatClockTime } from '../../../../shared/pipes/clock-time.pipe';
import { shortId } from '../../account-list';
import { dateText } from '../../../../shared/utils/dates';
import { recordTabs } from '../../account-tabs';
import {
  CONFIRM_TEXT,
  KYC_META,
  RESTAURANT_ACTIONS,
  RESTAURANT_STATUS_LABEL,
  RESTAURANT_STATUS_TONE,
  StatusAction,
  kycBadge,
} from '../restaurant-status';

/**
 * One restaurant account: the restaurant, its owner, KYC, menu, offers, orders, payouts,
 * reviews, complaints, activity and admin log. Approval actions need restaurants:approve;
 * suspending, reinstating and closing for orders need restaurants:status.
 */
@Component({
  selector: 'bb-restaurant-account',
  imports: [
    DetailNav,
    DatePipe,
    NgTemplateOutlet,
    TitleCasePipe,
    RouterLink,
    IconComponent,
    TabStrip,
    StatTile,
    RecordTable,
    KycReview,
    InrPipe,
    ClockTimePipe,
    InfoRows,
    PersonInfo,
  ],
  templateUrl: './restaurant-account.html',
  styleUrl: './restaurant-account.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestaurantAccount {
  private readonly api = inject(AdminRestaurantAccountsService);
  private readonly users = inject(AdminUsersService);
  private readonly dialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);
  protected readonly auth = inject(AuthService);

  readonly id = input.required<string>();

  protected readonly statusLabel = RESTAURANT_STATUS_LABEL;
  protected readonly statusTone = RESTAURANT_STATUS_TONE;
  protected readonly kycMeta = KYC_META;
  protected readonly accountMeta = USER_STATUS_META;
  protected readonly days = WEEK_DAYS;
  protected readonly shortId = shortId;

  protected readonly account = rxResource({
    params: () => this.id(),
    stream: ({ params }) => this.api.get(params),
  });
  protected readonly data = computed(() => loaded(this.account));
  protected readonly loadError = computed(() =>
    this.account.error()
      ? errorMessage(this.account.error(), 'Could not load this restaurant.')
      : null,
  );
  protected readonly busy = signal(false);
  private readonly day = dateText().day;

  /** The Restaurant info tab (quick facts, map link, legal rows) and the restaurant's own contact. */
  protected readonly info = computed(() => {
    const r = this.data()?.restaurant;
    if (!r) return null;
    const [lng, lat] = r.location.coordinates;
    const facts: InfoRow[] = [
      { icon: 'wallet', label: 'Cost for two', value: formatPaise(r.costForTwoPaise) },
      {
        icon: 'shopping-bag',
        label: 'Minimum order',
        value: r.minOrderPaise ? formatPaise(r.minOrderPaise) : 'None',
      },
      { icon: 'timer', label: 'Preparation', value: `${r.avgPrepTimeMinutes} min` },
      {
        icon: 'clock',
        label: 'Hours',
        value: `${formatClockTime(r.openingTime)} – ${formatClockTime(r.closingTime)}`,
      },
    ];
    const legal: InfoRow[] = [
      {
        icon: 'badge-check',
        label: 'FSSAI licence',
        value: r.fssaiNumber
          ? r.fssaiNumber +
            (r.fssaiValidUntil ? ` · valid until ${this.day(r.fssaiValidUntil)}` : '')
          : '—',
      },
      {
        icon: 'receipt',
        label: 'GST',
        value: r.gstRegistered ? r.gstin || 'Registered' : 'Not registered',
      },
    ];
    const contact: InfoRow[] = [
      { icon: 'phone', label: 'Phone', value: r.phone || '—' },
      { icon: 'mail', label: 'Email', value: r.email || '—' },
    ];
    return {
      facts,
      legal,
      contact,
      mapLink: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`,
      coords: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    };
  });

  protected readonly missingDocs = computed(() =>
    (this.data()?.kyc.missing ?? []).map(kindLabel).join(', '),
  );

  /** Approve / reject / ask for documents / suspend / reinstate, as this admin may. */
  protected readonly actions = computed(() => {
    const status = this.data()?.restaurant.status;
    if (!status) return [];
    return RESTAURANT_ACTIONS[status].filter((a) =>
      this.auth.can(
        a.status === 'suspended' || status === 'suspended'
          ? 'restaurants:status'
          : 'restaurants:approve',
      ),
    );
  });

  private readonly ownerId = () => this.data()?.owner?.id ?? '';
  protected readonly tab = signal('overview');
  protected readonly records = recordTabs(this.tab, (t) => [
    t.menu(this.id),
    t.offers(this.id),
    t.orders('restaurant', this.id),
    t.payouts('restaurant', this.id),
    t.reviews('restaurantId', this.id),
    t.support(this.ownerId, 'Complaints'),
    t.activity(this.ownerId),
    t.audit(() => [this.id(), this.ownerId()].filter(Boolean)),
  ]);
  protected readonly tabs = computed(() => [
    { id: 'overview', label: 'Overview', content: '' },
    { id: 'restaurant', label: 'Restaurant info', content: '' },
    { id: 'owner', label: 'Owner & contact', content: '' },
    ...(this.canSeeKyc()
      ? [{ id: 'kyc', label: 'KYC & bank', content: '', badge: kycBadge(this.data()?.kyc.status) }]
      : []),
    ...this.records.strip(),
  ]);
  protected readonly canSeeKyc = computed(() =>
    this.auth.can('restaurants:kyc', 'restaurants:manage'),
  );

  protected act(action: StatusAction): void {
    const r = this.data()!.restaurant;
    confirmed(this.dialog, {
      title: `${action.label} ${r.name}?`,
      message: CONFIRM_TEXT[action.status],
      confirmLabel: action.label,
      danger: action.danger,
      reasonLabel: action.needsReason ? 'Reason (shown to the restaurant owner)' : undefined,
    }).subscribe((result) =>
      this.run(
        this.api.setStatus(r.id, action.status, typeof result === 'string' ? result : undefined),
      ),
    );
  }

  /** Temporarily close the restaurant for new orders (with a reason), or reopen it. */
  protected toggleOrders(): void {
    const r = this.data()!.restaurant;
    const closing = r.isAcceptingOrders;
    confirmed(this.dialog, {
      title: closing ? `Close ${r.name} for orders?` : `Reopen ${r.name} for orders?`,
      message: closing
        ? 'Customers cannot order until it reopens. The owner can reopen it from their panel.'
        : 'Customers can order again during its opening hours.',
      confirmLabel: closing ? 'Close for orders' : 'Reopen',
      danger: closing,
      reasonLabel: closing ? 'Reason (shown to the restaurant owner)' : undefined,
    }).subscribe((result) =>
      this.run(
        this.api.setAccepting(r.id, !closing, typeof result === 'string' ? result : undefined),
      ),
    );
  }

  protected changeOwnerStatus(): void {
    const owner = this.data()!.owner!;
    openAccountStatus(this.dialog, {
      user: owner,
      kind: 'restaurants',
      save: (status, reason) => this.users.setStatus(owner.id, status, reason),
    }).subscribe((updated) => {
      this.account.update((d) => d && { ...d, owner: updated });
      this.notify.success(
        `The owner's account is now ${USER_STATUS_META[updated.status].label.toLowerCase()}`,
      );
    });
  }

  private run(request: Observable<Restaurant>): void {
    this.busy.set(true);
    request.subscribe({
      next: (restaurant) => {
        this.busy.set(false);
        this.account.update((d) => d && { ...d, restaurant });
        this.account.reload(); // KYC and stats can follow from the change
        this.notify.success('Restaurant updated');
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.notify.error(errorMessage(err));
      },
    });
  }
}
