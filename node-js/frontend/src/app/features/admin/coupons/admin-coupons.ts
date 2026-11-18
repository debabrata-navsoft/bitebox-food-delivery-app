import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  ButtonComponent,
  IconComponent,
  MenuComponent,
  PaginationComponent,
  SelectOption,
  type MenuItem,
} from 'nexprime';
import { filter } from 'rxjs';
import { AdminCouponService } from '../../../core/services/checkout-api.service';
import { NotificationService } from '../../../core/services/notification.service';
import { confirmed } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { ListEmpty } from '../../../shared/components/list-empty/list-empty';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { StatTile } from '../../../shared/components/stat-tile/stat-tile';
import { channelsLabel, conditionsLabel, discountLabel, scopeLabel } from '../../../shared/coupons/coupon-labels';
import {
  COUPON_STATUS_SECTION,
  DISCOUNT_TYPE_SECTION,
  loaded,
  rowActions,
} from '../../../shared/coupons/coupon-list';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { COMPACT_MENU_WIDTH, toggleEndAligned } from '../../../shared/menu/end-aligned-menu';
import { datesSection, filteredList, optionsSection } from '../../../shared/list/filtered-list';
import { TableLabels } from '../../../shared/list/table-labels';
import {
  AdminCoupon,
  COUPON_KIND_LABEL,
  COUPON_STATUS_LABEL,
  COUPON_STATUS_TONE,
} from '../../../shared/models/checkout.models';
import { InrPipe, formatPaise } from '../../../shared/pipes/money.pipes';
import { CouponFormDialog } from './coupon-form-dialog/coupon-form-dialog';

/** Platform coupons and restaurant offers: totals, a filterable list and the row actions. */
@Component({
  selector: 'bb-admin-coupons',
  imports: [
    DatePipe,
    RouterLink,
    ListToolbar,
    ButtonComponent,
    IconComponent,
    MenuComponent,
    PaginationComponent,
    ListEmpty,
    PageHeader,
    StatTile,
    TableLabels,
    InrPipe,
  ],
  templateUrl: './admin-coupons.html',
  styleUrl: './admin-coupons.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCoupons {
  private readonly service = inject(AdminCouponService);
  private readonly bbDialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);
  protected readonly statusLabel = COUPON_STATUS_LABEL;
  protected readonly statusTone = COUPON_STATUS_TONE;
  protected readonly discountLabel = discountLabel;
  protected readonly scopeLabel = scopeLabel;
  protected readonly conditionsLabel = conditionsLabel;
  protected readonly channelsLabel = channelsLabel;
  protected readonly formatPaise = formatPaise;

  private readonly stats = rxResource({ stream: () => this.service.analytics() });
  /** Hidden while loading or after an error. */
  protected readonly totals = computed(() => loaded(this.stats));

  protected readonly kindLabel = COUPON_KIND_LABEL;
  protected readonly sortOptions: SelectOption[] = [
    { value: 'newest', label: 'Newest first' },
    { value: 'oldest', label: 'Oldest first' },
    { value: 'expiring', label: 'Ending soonest' },
    { value: 'most_used', label: 'Most used' },
    { value: 'code', label: 'Code A–Z' },
  ];

  /** Names of the restaurants on this page, for a chip whose counts haven't loaded. */
  private readonly restaurantNames = computed(
    () =>
      new Map(
        (this.list.data()?.items ?? []).flatMap((c) =>
          typeof c.restaurant === 'object' && c.restaurant ? [[c.restaurant.id, c.restaurant.name] as const] : [],
        ),
      ),
  );

  protected readonly filterSections = [
    COUPON_STATUS_SECTION,
    optionsSection('kind', 'Type', COUPON_KIND_LABEL),
    optionsSection('owner', 'Created by', { platform: 'BiteBox coupons', restaurant: 'Restaurant offers' }),
    optionsSection('audience', 'Audience', {
      all: 'All customers',
      new: 'New customers',
      existing: 'Returning customers',
    }),
    DISCOUNT_TYPE_SECTION,
    // From the API's counts, with their names.
    optionsSection('restaurant', 'Restaurant', (id) => this.restaurantNames().get(id) ?? id),
    // Coupons valid at some time in the range (`from` / `to` as instants).
    datesSection('valid', 'Valid between', ['from', 'to']),
  ];

  protected readonly coupons = filteredList((query) => this.service.list(query), {
    errorText: 'Could not load coupons.',
    sort: 'newest',
    instants: true,
  });
  protected readonly list = this.coupons.list;

  protected readonly toggleMenu = (menu: MenuComponent, event: Event) =>
    toggleEndAligned(menu, event, COMPACT_MENU_WIDTH);

  /** Each coupon's actions menu (built once per page of results). */
  protected readonly menus = computed(
    () =>
      new Map<string, MenuItem[]>(
        (this.list.data()?.items ?? []).map((c) => [
          c.id,
          [
            { label: 'Edit', icon: 'pencil', command: () => this.open(c) },
            ...(c.approvalStatus === 'approved'
              ? [
                  c.isActive
                    ? { label: 'Pause', icon: 'pause', command: () => this.setActive(c, false) }
                    : { label: 'Activate', icon: 'play', command: () => this.setActive(c, true) },
                ]
              : []),
            { label: 'Duplicate', icon: 'copy', command: () => this.duplicate(c) },
            ...(c.usedCount === 0
              ? [{ label: 'Delete', icon: 'trash-2', command: () => this.remove(c) }]
              : []),
          ],
        ]),
      ),
  );

  /** "Spice Route Kitchen" for a restaurant's own offer, "BiteBox" otherwise. */
  protected owner(c: AdminCoupon): string {
    if (c.source !== 'restaurant') return 'BiteBox';
    return typeof c.restaurant === 'object' && c.restaurant ? c.restaurant.name : 'Restaurant';
  }

  private readonly actions = rowActions(() => {
    this.list.reload();
    this.stats.reload();
  });
  protected readonly busy = this.actions.busy;

  protected open(coupon?: AdminCoupon): void {
    this.bbDialog
      .open<CouponFormDialog, AdminCoupon | null, AdminCoupon>(CouponFormDialog, {
        data: coupon ?? null,
        width: '640px',
      })
      .closed.pipe(filter(Boolean))
      .subscribe((saved) => {
        this.notify.success(coupon ? 'Coupon saved' : `Coupon ${saved.code} created`);
        this.list.reload();
        this.stats.reload();
      });
  }

  protected setActive(c: AdminCoupon, isActive: boolean): void {
    this.actions.run(c.id, this.service.setActive(c.id, isActive), isActive ? 'Coupon activated' : 'Coupon paused');
  }

  protected duplicate(c: AdminCoupon): void {
    this.actions.run(c.id, this.service.duplicate(c.id), 'Copy created (switched off until you activate it)');
  }

  protected remove(c: AdminCoupon): void {
    confirmed(this.bbDialog, {
      title: `Delete ${c.code}?`,
      message: 'Customers will no longer be able to use it.',
      confirmLabel: 'Delete',
      danger: true,
    }).subscribe(() => this.actions.run(c.id, this.service.remove(c.id), 'Coupon deleted'));
  }
}
