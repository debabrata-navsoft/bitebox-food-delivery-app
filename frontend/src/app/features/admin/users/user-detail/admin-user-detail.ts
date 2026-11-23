import { DatePipe, TitleCasePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  booleanAttribute,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormRoot, TreeValidationResult, form } from '@angular/forms/signals';
import { MatDialog } from '@angular/material/dialog';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from 'nexprime';
import { TabStrip } from '../../../../shared/components/tab-strip/tab-strip';
import { RecordTable } from '../../../../shared/components/record-table/record-table';
import { shortId } from '../../account-list';
import { recordTabs } from '../../account-tabs';
import { Observable, filter, firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import {
  AdminUsersService,
  UserProfilePatch,
} from '../../../../core/services/admin/admin-users.service';
import { errorMessage, fieldErrors } from '../../../../shared/utils/api-error';
import { NotificationService } from '../../../../core/services/notification.service';
import { AdminOrdersService } from '../../../../core/services/order-management.service';
import {
  ADDRESS_OWNER,
  AddressFormDialog,
  AddressOwner,
} from '../../../../shared/components/address-form-dialog/address-form-dialog';
import { confirmed } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { OrderStatusChip } from '../../../../shared/components/order-status-chip/order-status-chip';
import { StatTile } from '../../../../shared/components/stat-tile/stat-tile';
import { loaded } from '../../../../shared/coupons/coupon-list';
import { BbDialog } from '../../../../shared/dialog/bb-dialog';
import { birthDateRange, fromIsoDay, isoDay } from '../../../../shared/utils/dates';
import { serverErrors, shownError } from '../../../../shared/forms/form-errors';
import { requiredText } from '../../../../shared/validators/form-rules';
import { NP_FORM_FIELDS } from '../../../../shared/forms/np-form-fields';
import { DeliveryAddress, customerStatusLabel } from '../../../../core/models/checkout.models';
import {
  GENDER_LABEL,
  Gender,
  MEMBER_KIND,
  ROLE_META,
  USER_STATUS_META,
  User,
} from '../../../../core/models/user.models';
import { openAccountStatus, statusChanged } from '../../../../shared/components/account-status-dialog/account-status-dialog';
import { ImageUpload } from '../../../../shared/components/image-upload/image-upload';
import { InrPipe } from '../../../../shared/pipes/money.pipes';
import { openAdminOrder } from '../../orders/admin-order-dialog/admin-order-dialog';

const RECENT_ORDERS = 5;

// Email and phone are the person's sign-in details: only they can change them.
const profileOf = (u: User | undefined) => ({
  name: u?.name ?? '',
  gender: (u?.gender ?? '') as Gender | '',
  birthDate: fromIsoDay(u?.birthDate),
});

/**
 * One customer, restaurant partner or rider: profile, order totals, saved addresses and recent
 * orders. /admin/users/:id shows it; /admin/users/:id/edit edits the name, date of birth and
 * addresses (email and phone are changed only by the person).
 * Orders stay read-only here (they change only through the order workflow).
 */
@Component({
  selector: 'bb-admin-user-detail',
  imports: [
    DatePipe,
    TitleCasePipe,
    RouterLink,
    FormRoot,
    NP_FORM_FIELDS,
    IconComponent,
    StatTile,
    ImageUpload,
    RecordTable,
    TabStrip,
    OrderStatusChip,
    InrPipe,
  ],
  templateUrl: './admin-user-detail.html',
  styleUrl: './admin-user-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUserDetail {
  private readonly api = inject(AdminUsersService);
  private readonly orderApi = inject(AdminOrdersService);
  private readonly bbDialog = inject(BbDialog);
  private readonly matDialog = inject(MatDialog);
  private readonly injector = inject(Injector);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  readonly id = input.required<string>();
  /** Route data: true on the edit page. */
  readonly edit = input(false, { transform: booleanAttribute });
  /**
   * Route data: the list this page belongs to (Customers or Users). Routes without it bind
   * `undefined`, which would override a plain default, hence the transform.
   */
  readonly base = input('/admin/users', {
    transform: (v: string | undefined) => v ?? '/admin/users',
  });

  protected readonly roleMeta = ROLE_META;
  protected readonly statusMeta = USER_STATUS_META;
  protected readonly genderLabel = GENDER_LABEL;
  protected readonly fromIsoDay = fromIsoDay;
  protected readonly shortId = shortId;
  protected readonly statusLabel = customerStatusLabel;
  protected readonly shownError = shownError;
  protected readonly born = birthDateRange();

  private readonly detail = rxResource({
    params: () => this.id(),
    stream: ({ params }) => this.api.get(params),
  });
  protected readonly data = computed(() => loaded(this.detail));
  protected readonly loadError = computed(() =>
    this.detail.error() ? errorMessage(this.detail.error(), 'Could not load this user.') : null,
  );
  protected readonly isCustomer = computed(() => this.data()?.user.role === 'customer');

  // Customers: a tab per part of the account; record tabs only with that area's permission.
  // Each tab lists a different kind of record, so the list holds them loosely typed.
  protected readonly tab = linkedSignal<string>(() => (this.edit() ? 'profile' : 'overview'));
  protected readonly records = recordTabs(this.tab, (t) => [
    t.orders('customer', this.id, () => this.recent.reload()),
    t.payments(this.id),
    t.coins(this.id),
    t.reviews('customer', this.id),
    t.support(this.id),
    t.activity(this.id),
    t.audit(() => [this.id()]),
  ]);
  protected readonly tabs = computed(() => [
    { id: 'overview', label: 'Overview', content: '' },
    { id: 'profile', label: 'Personal info', content: '' },
    { id: 'addresses', label: 'Addresses', content: '', badge: this.data()?.addresses.length || undefined },
    ...this.records.strip(),
  ]);
  /** Non-customers have no tabs: every section shows at once. */
  protected shows(tab: string): boolean {
    return !this.isCustomer() || this.tab() === tab;
  }

  /** The customer's latest orders (admins who can see orders). */
  private readonly recent = rxResource({
    params: () => (this.isCustomer() && this.auth.can('orders:view') ? this.id() : undefined),
    stream: ({ params }) => this.orderApi.list({ customer: params, limit: RECENT_ORDERS }),
  });
  protected readonly orders = computed(() => loaded(this.recent));

  // Profile form (edit page): starts from the loaded user, sends only what changed.
  private readonly profile = linkedSignal(() => profileOf(this.data()?.user));
  protected readonly form = form(
    this.profile,
    (p) => requiredText(p.name, 'Name', { min: 2, max: 80 }),
    { submission: { action: () => this.save() } },
  );
  /** The profile photo on the edit page (uploaded straight away; saved with the form). */
  protected readonly photo = linkedSignal(() => this.data()?.user.avatarUrl ?? '');
  protected readonly genderOptions = [
    { value: '', label: 'Not set' },
    ...(Object.keys(GENDER_LABEL) as Gender[]).map((g) => ({ value: g, label: GENDER_LABEL[g] })),
  ];
  protected readonly formError = signal<string | null>(null);
  protected readonly busyAddress = signal<string | null>(null);
  protected readonly helping = signal(false);

  private async save(): Promise<TreeValidationResult> {
    const user = this.data()!.user;
    const v = this.profile();
    const patch: UserProfilePatch = {};
    if (v.name.trim() !== user.name) patch.name = v.name.trim();
    if (v.gender !== (user.gender ?? '')) patch.gender = v.gender || null;
    if (this.photo() !== (user.avatarUrl ?? '')) patch.avatarUrl = this.photo() || null;
    const day = v.birthDate ? isoDay(v.birthDate) : null;
    if (day !== (user.birthDate?.slice(0, 10) ?? null)) patch.birthDate = day;
    this.formError.set(null);
    try {
      if (Object.keys(patch).length) {
        const updated = await firstValueFrom(this.api.update(user.id, patch));
        this.detail.update((d) => d && { ...d, user: updated });
        this.notify.success('User updated');
      }
      void this.router.navigate([this.base(), user.id]);
      return undefined;
    } catch (err) {
      const details = fieldErrors(err);
      if (!details.length) this.formError.set(errorMessage(err));
      return serverErrors(this.form, details);
    }
  }

  protected changeStatus(): void {
    const user = this.data()!.user;
    openAccountStatus(this.bbDialog, {
      user,
      kind: MEMBER_KIND[user.role as keyof typeof MEMBER_KIND],
      save: (status, reason) => this.api.setStatus(user.id, status, reason),
    }).subscribe((updated) => {
      this.detail.update((d) => d && { ...d, user: updated });
      this.notify.success(statusChanged(updated));
    });
  }

  // Account help: the customer's own reset and verification emails (admins never see passwords).
  protected sendPasswordReset(): void {
    this.help(this.api.sendPasswordReset(this.id()));
  }

  protected sendEmailVerification(): void {
    this.help(this.api.sendEmailVerification(this.id()));
  }

  private help(request: Observable<string>): void {
    this.helping.set(true);
    request.subscribe({
      next: (message) => {
        this.helping.set(false);
        this.notify.success(message);
      },
      error: (err: unknown) => {
        this.helping.set(false);
        this.notify.error(errorMessage(err));
      },
    });
  }

  protected openOrder(orderId: string): void {
    openAdminOrder(this.bbDialog, orderId).subscribe(() => this.recent.reload());
  }

  // Addresses (edit page): the customer's own address dialog, saving to the admin API.
  protected editAddress(address: DeliveryAddress | null): void {
    const user = this.data()!.user;
    const owner: AddressOwner = {
      name: user.name,
      phone: user.phone,
      create: (input) => this.api.createAddress(user.id, input),
      update: (addressId, input) => this.api.updateAddress(user.id, addressId, input),
    };
    this.matDialog
      .open<AddressFormDialog, DeliveryAddress | null, DeliveryAddress>(AddressFormDialog, {
        data: address,
        width: '640px',
        maxWidth: '95vw',
        autoFocus: 'first-tabbable',
        injector: Injector.create({
          providers: [{ provide: ADDRESS_OWNER, useValue: owner }],
          parent: this.injector,
        }),
      })
      .afterClosed()
      .pipe(filter(Boolean))
      .subscribe(() => {
        this.notify.success(address ? 'Address updated' : 'Address added');
        this.detail.reload();
      });
  }

  protected makeDefault(a: DeliveryAddress): void {
    this.run(a, this.api.setDefaultAddress(this.id(), a.id), 'Default address changed');
  }

  protected removeAddress(a: DeliveryAddress): void {
    confirmed(this.bbDialog, {
      title: 'Delete this address?',
      message: `${a.line1}, ${a.city} will be removed from ${this.data()!.user.name}'s saved addresses.`,
      confirmLabel: 'Delete',
      danger: true,
    }).subscribe(() => this.run(a, this.api.removeAddress(this.id(), a.id), 'Address deleted'));
  }

  private run(a: DeliveryAddress, request: Observable<unknown>, done: string): void {
    this.busyAddress.set(a.id);
    request.subscribe({
      next: () => {
        this.busyAddress.set(null);
        this.notify.success(done);
        this.detail.reload();
      },
      error: (err: unknown) => {
        this.busyAddress.set(null);
        this.notify.error(errorMessage(err));
      },
    });
  }
}
