import { DatePipe, DecimalPipe } from '@angular/common';
import { AuthService } from '../../../../core/auth/auth.service';
import { DetailNav } from '../../../../shared/components/detail-nav/detail-nav';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { finalize } from 'rxjs';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IconComponent } from 'nexprime';
import { errorMessage } from '../../../../shared/utils/api-error';
import { NotificationService } from '../../../../core/services/notification.service';
import { AdminOrdersService } from '../../../../core/services/order-management.service';
import { confirmed } from '../../../../shared/components/confirm-dialog/confirm-dialog';
import { DECISIONS, Decision } from '../../rider-accounts/rider-status';
import { riderStatusAction, riderStatusChanger } from '../rider-account-status';
import { InfoRow, InfoRows } from '../../../../shared/components/info-rows/info-rows';
import { dateText } from '../../../../shared/utils/dates';
import { KycReview } from '../../../../shared/components/kyc/kyc-review/kyc-review';
import { BbDialog } from '../../../../shared/dialog/bb-dialog';
import { VEHICLE_LABEL } from '../../../../core/models/checkout.models';
import {
  RIDER_VERIFICATION_LABEL,
  RIDER_VERIFICATION_TONE,
  RiderVerificationStatus,
  riderReviewState,
} from '../../../../core/models/order-management.models';

/** One rider: details, verification documents and bank account, and the verification decision. */
@Component({
  selector: 'bb-admin-rider-review',
  imports: [DetailNav, DatePipe, DecimalPipe, RouterLink, IconComponent, KycReview, InfoRows],
  templateUrl: './admin-rider-review.html',
  styleUrl: './admin-rider-review.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminRiderReview {
  private readonly api = inject(AdminOrdersService);
  private readonly dialog = inject(BbDialog);
  private readonly notify = inject(NotificationService);
  protected readonly auth = inject(AuthService);

  readonly id = input.required<string>();

  protected readonly rider = rxResource({
    params: () => this.id(),
    stream: ({ params }) => this.api.rider(params),
  });
  protected readonly data = computed(() => (this.rider.hasValue() ? this.rider.value() : null));
  protected readonly loadError = computed(() =>
    this.rider.error() ? errorMessage(this.rider.error(), 'Could not load this rider.') : null,
  );
  protected readonly status = computed<RiderVerificationStatus>(
    () => this.data()?.profile.verification?.status ?? 'pending',
  );
  /** The badge: "Not submitted" while the rider still has something to send. */
  protected readonly state = computed(() =>
    riderReviewState({
      status: this.status(),
      submitted: this.data()?.profile.verification?.submitted,
    }),
  );
  protected readonly decisions = computed(() => DECISIONS[this.status()]);
  private readonly dates = dateText();

  /** The rider with the hero's quick facts and the sidebar lists, worked out once. */
  protected readonly view = computed(() => {
    const detail = this.data();
    if (!detail) return null;
    const { user, profile: p } = detail;
    const { day } = this.dates;
    const vehicle = p.vehicleType ? VEHICLE_LABEL[p.vehicleType] : 'Not added';
    return {
      detail,
      kpis: [
        { icon: 'package-check', label: 'Deliveries', value: `${p.completedDeliveries}` },
        {
          icon: 'star',
          label: 'Rating',
          value: p.rating?.count ? p.rating.average.toFixed(1) : '—',
          note: p.rating?.count ? `${p.rating.count} reviews` : undefined,
        },
        { icon: 'bike', label: 'Vehicle', value: vehicle, note: p.vehicleNumber?.toUpperCase() },
        {
          icon: 'radio',
          label: 'Availability',
          value: p.isOnline ? 'Online' : 'Offline',
          note: p.locationUpdatedAt
            ? `Seen ${day(p.locationUpdatedAt, 'd MMM, h:mm a')}`
            : undefined,
        },
        { icon: 'calendar', label: 'Joined', value: day(user.createdAt) },
      ] as InfoRow[],
      contact: [
        { icon: 'mail', label: 'Email', value: user.email },
        { icon: 'phone', label: 'Phone', value: user.phone || '—' },
      ],
    };
  });
  protected readonly label = RIDER_VERIFICATION_LABEL;
  protected readonly tone = RIDER_VERIFICATION_TONE;
  protected readonly statusAction = riderStatusAction;
  /** While a suspension or reactivation saves (its button waits). */
  protected readonly changingStatus = signal(false);
  private readonly changeStatus = riderStatusChanger();

  /** Suspends an active rider or reactivates a suspended one, as on the Delivery partners list. */
  protected toggleStatus(): void {
    const user = this.data()?.user;
    if (!user) return;
    this.changingStatus.set(true);
    this.changeStatus(user)
      .pipe(finalize(() => this.changingStatus.set(false)))
      .subscribe(() => this.rider.reload());
  }

  protected decide(d: Decision): void {
    const name = this.data()?.user.name ?? 'this rider';
    confirmed(this.dialog, {
      title: `${d.label}: ${name}?`,
      message: d.message,
      confirmLabel: d.label,
      danger: d.danger,
      reasonLabel: d.status === 'approved' ? undefined : 'Reason (shown to the rider)',
    }).subscribe((result) => {
      const reason = typeof result === 'string' ? result : '';
      this.api.setRiderVerification(this.id(), d.status, reason).subscribe({
        next: (detail) => {
          this.rider.set(detail);
          this.notify.success(`${name}: ${RIDER_VERIFICATION_LABEL[d.status]}`);
        },
        error: (err: unknown) => this.notify.error(errorMessage(err)),
      });
    });
  }
}
