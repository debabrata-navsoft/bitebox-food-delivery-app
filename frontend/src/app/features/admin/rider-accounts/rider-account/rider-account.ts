import { DatePipe } from '@angular/common';
import { DetailNav } from '../../../../shared/components/detail-nav/detail-nav';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IconComponent } from 'nexprime';
import { TabStrip } from '../../../../shared/components/tab-strip/tab-strip';
import { Observable } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import {
  AdminRiderAccountsService,
  RiderAccount as Account,
} from '../../../../core/services/admin/admin-rider-accounts.service';
import { AdminUsersService } from '../../../../core/services/admin/admin-users.service';
import { errorMessage } from '../../../../shared/utils/api-error';
import { NotificationService } from '../../../../core/services/notification.service';
import {
  openAccountStatus,
  statusChanged,
} from '../../../../shared/components/account-status-dialog/account-status-dialog';
import { confirmed } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { KycReview } from '../../../../shared/components/kyc/kyc-review/kyc-review';
import { RecordTable } from '../../../../shared/components/record-table/record-table';
import { StatTile } from '../../../../shared/components/stat-tile/stat-tile';
import { loaded } from '../../../../shared/coupons/coupon-list';
import { BbDialog } from '../../../../shared/dialog/bb-dialog';
import { PersonInfo } from '../../../../shared/components/person-info/person-info';
import { addressLine } from '../../../../shared/utils/address';
import { VEHICLE_LABEL } from '../../../../core/models/checkout.models';
import { kindLabel } from '../../../../core/models/kyc.models';
import {
  RIDER_VERIFICATION_LABEL,
  RIDER_VERIFICATION_TONE,
  riderReviewState,
} from '../../../../core/models/order-management.models';
import { USER_STATUS_META } from '../../../../core/models/user.models';
import { InrPipe } from '../../../../shared/pipes/money.pipes';
import { shortId } from '../../account-list';
import { recordTabs } from '../../account-tabs';
import { KYC_META, kycBadge } from '../../restaurant-accounts/restaurant-status';
import { DECISIONS, Decision, availabilityOf } from '../rider-status';

/**
 * One delivery partner: personal details, vehicle, KYC and bank, deliveries, payouts, reviews,
 * complaints, availability history, sign-ins and admin log. Verification needs riders:approve;
 * taking a rider offline needs riders:status.
 */
@Component({
  selector: 'bb-rider-account',
  imports: [
    PersonInfo,
    DetailNav,
    DatePipe,
    RouterLink,
    IconComponent,
    TabStrip,
    StatTile,
    RecordTable,
    KycReview,
    InrPipe,
  ],
  templateUrl: './rider-account.html',
  styleUrl: './rider-account.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RiderAccount {
  private readonly api = inject(AdminRiderAccountsService);
  private readonly users = inject(AdminUsersService);
  private readonly dialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);
  protected readonly auth = inject(AuthService);

  readonly id = input.required<string>();

  protected readonly verificationLabel = RIDER_VERIFICATION_LABEL;
  protected readonly verificationTone = RIDER_VERIFICATION_TONE;
  protected readonly kycMeta = KYC_META;
  /** The Personal info tab's address and emergency contact, written out (null: not added). */
  protected readonly contactLines = computed(() => {
    const r = this.data()?.rider;
    const e = r?.emergencyContact;
    return {
      address: r?.address ? addressLine(r.address) : null,
      emergency: e ? `${e.name} · ${e.phone}${e.relation ? ` (${e.relation})` : ''}` : null,
    };
  });

  protected readonly accountMeta = USER_STATUS_META;
  protected readonly vehicleLabel = VEHICLE_LABEL;
  protected readonly shortId = shortId;

  protected readonly account = rxResource({
    params: () => this.id(),
    stream: ({ params }) => this.api.get(params),
  });
  protected readonly data = computed(() => loaded(this.account));
  protected readonly loadError = computed(() =>
    this.account.error()
      ? errorMessage(this.account.error(), 'Could not load this delivery partner.')
      : null,
  );
  protected readonly busy = signal(false);
  protected readonly review = computed(() => {
    const v = this.data()?.rider.verification;
    return v ? riderReviewState(v) : 'pending';
  });
  protected readonly availability = computed(() => {
    const r = this.data()?.rider;
    return r
      ? availabilityOf({
          isOnline: r.isOnline,
          busy: !!(r as { activeOrder?: string | null }).activeOrder,
        })
      : null;
  });
  protected readonly decisions = computed(() => {
    const status = this.data()?.rider.verification?.status;
    return status && this.auth.can('riders:approve') ? DECISIONS[status] : [];
  });
  protected readonly missingDocs = computed(() =>
    (this.data()?.kyc.missing ?? []).map(kindLabel).join(', '),
  );

  protected readonly tab = signal('overview');
  protected readonly records = recordTabs(this.tab, (t) => [
    t.orders('rider', this.id),
    t.payouts('rider', this.id),
    t.reviews('rider', this.id),
    t.support(this.id, 'Complaints'),
    t.availability(this.id),
    t.activity(this.id),
    t.audit(() => [this.id()]),
  ]);
  protected readonly canSeeKyc = computed(() => this.auth.can('riders:kyc', 'riders:manage'));
  protected readonly tabs = computed(() => [
    { id: 'overview', label: 'Overview', content: '' },
    { id: 'personal', label: 'Personal info', content: '' },
    ...(this.canSeeKyc()
      ? [{ id: 'kyc', label: 'KYC & bank', content: '', badge: kycBadge(this.data()?.kyc.status) }]
      : []),
    ...this.records.strip(),
  ]);

  protected decide(d: Decision): void {
    const name = this.data()!.user.name;
    confirmed(this.dialog, {
      title: `${d.label}: ${name}?`,
      message: d.message,
      confirmLabel: d.label,
      danger: d.danger,
      reasonLabel: d.status === 'approved' ? undefined : 'Reason (shown to the rider)',
    }).subscribe((result) =>
      this.run(
        this.api.setVerification(
          this.id(),
          d.status,
          typeof result === 'string' ? result : undefined,
        ),
      ),
    );
  }

  protected takeOffline(): void {
    confirmed(this.dialog, {
      title: `Take ${this.data()!.user.name} offline?`,
      message: 'They stop getting delivery offers now. They can go online again themselves.',
      confirmLabel: 'Take offline',
      danger: true,
      reasonLabel: 'Reason (shown to the rider)',
    }).subscribe((reason) => this.run(this.api.takeOffline(this.id(), String(reason))));
  }

  protected changeStatus(): void {
    const user = this.data()!.user;
    openAccountStatus(this.dialog, {
      user,
      kind: 'riders',
      save: (status, reason) => this.users.setStatus(user.id, status, reason),
    }).subscribe((updated) => {
      this.notify.success(statusChanged(updated));
      this.account.reload(); // a non-active rider is also taken offline
    });
  }

  private run(request: Observable<Account>): void {
    this.busy.set(true);
    request.subscribe({
      next: (account) => {
        this.busy.set(false);
        this.account.set(account);
        this.notify.success('Delivery partner updated');
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.notify.error(errorMessage(err));
      },
    });
  }
}
