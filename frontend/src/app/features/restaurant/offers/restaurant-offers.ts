import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import {
  ButtonComponent,
  IconComponent,
  MenuComponent,
  PaginationComponent,
  type MenuItem,
} from 'nexprime';
import { filter } from 'rxjs';
import { MyOffersService } from '../../../core/services/my-offers.service';
import { NotificationService } from '../../../core/services/notification.service';
import { confirmed } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { ListEmpty } from '../../../shared/components/list-empty/list-empty';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { StatTile } from '../../../shared/components/stat-tile/stat-tile';
import { conditionsLabel, discountLabel, itemsLabel } from '../../../shared/coupons/coupon-labels';
import {
  COUPON_STATUS_SECTION,
  DISCOUNT_TYPE_SECTION,
  loaded,
  rowActions,
} from '../../../shared/coupons/coupon-list';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { datesSection, filteredList } from '../../../shared/list/filtered-list';
import { TableLabels } from '../../../shared/directives/table-labels';
import { COMPACT_MENU_WIDTH, toggleEndAligned } from '../../../shared/utils/end-aligned-menu';
import {
  AdminCoupon,
  COUPON_STATUS_LABEL,
  COUPON_STATUS_TONE,
} from '../../../core/models/checkout.models';
import { formatPaise } from '../../../shared/pipes/money.pipes';
import { OfferFormDialog } from './offer-form-dialog/offer-form-dialog';

/** What a save did, by the offer's state afterwards. */
const SAVED: Partial<Record<AdminCoupon['status'], string>> = {
  draft: 'Saved as a draft',
  pending: 'Sent to BiteBox for approval',
  active: 'Your offer is live',
  scheduled: 'Your offer is approved and starts on its start date',
};

/** The restaurant's own offers: totals, the list with approval status, and the form. */
@Component({
  selector: 'bb-restaurant-offers',
  imports: [
    DatePipe,
    ListToolbar,
    ButtonComponent,
    IconComponent,
    MenuComponent,
    PaginationComponent,
    ListEmpty,
    PageHeader,
    StatTile,
    TableLabels,
  ],
  templateUrl: './restaurant-offers.html',
  styleUrl: './restaurant-offers.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestaurantOffers {
  private readonly service = inject(MyOffersService);
  private readonly bbDialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);
  protected readonly statusLabel = COUPON_STATUS_LABEL;
  protected readonly statusTone = COUPON_STATUS_TONE;
  protected readonly discountLabel = discountLabel;
  protected readonly itemsLabel = itemsLabel;
  protected readonly conditionsLabel = conditionsLabel;
  protected readonly formatPaise = formatPaise;

  private readonly stats = rxResource({ stream: () => this.service.analytics() });
  /** Hidden while loading or after an error. */
  protected readonly totals = computed(() => loaded(this.stats));

  protected readonly filterSections = [
    COUPON_STATUS_SECTION,
    DISCOUNT_TYPE_SECTION,
    // Offers running at some time in the range (`from` / `to` as instants).
    datesSection('valid', 'Runs between', ['from', 'to']),
  ];

  /** The restaurant's own offers; the panel's counts cover only them. */
  protected readonly offers = filteredList((query) => this.service.list(query), {
    errorText: 'Could not load your offers.',
    instants: true,
  });
  protected readonly list = this.offers.list;

  protected readonly toggleMenu = (menu: MenuComponent, event: Event) =>
    toggleEndAligned(menu, event, COMPACT_MENU_WIDTH);

  protected readonly menus = computed(
    () =>
      new Map<string, MenuItem[]>(
        (this.list.data()?.items ?? []).map((o) => [
          o.id,
          [
            { label: 'Edit', icon: 'pencil', command: () => this.open(o) },
            o.isActive
              ? { label: 'Pause', icon: 'pause', command: () => this.setActive(o, false) }
              : { label: 'Resume', icon: 'play', command: () => this.setActive(o, true) },
            ...(o.usedCount === 0 ? [{ label: 'Delete', icon: 'trash-2', command: () => this.remove(o) }] : []),
          ],
        ]),
      ),
  );

  private readonly actions = rowActions(() => {
    this.list.reload();
    this.stats.reload();
  });
  protected readonly busy = this.actions.busy;

  protected open(offer?: AdminCoupon): void {
    this.bbDialog
      .open<OfferFormDialog, AdminCoupon | null, AdminCoupon>(OfferFormDialog, {
        data: offer ?? null,
        width: '920px',
      })
      .closed.pipe(filter(Boolean))
      .subscribe((saved) => {
        this.notify.success(SAVED[saved.status] ?? 'Offer saved');
        this.list.reload();
        this.stats.reload();
      });
  }

  protected setActive(o: AdminCoupon, isActive: boolean): void {
    this.actions.run(o.id, this.service.setActive(o.id, isActive), isActive ? 'Offer resumed' : 'Offer paused');
  }

  protected remove(o: AdminCoupon): void {
    confirmed(this.bbDialog, {
      title: `Delete ${o.name || 'this offer'}?`,
      message: 'Customers will no longer see or use this offer.',
      confirmLabel: 'Delete',
      danger: true,
    }).subscribe(() => this.actions.run(o.id, this.service.remove(o.id), 'Offer deleted'));
  }
}
