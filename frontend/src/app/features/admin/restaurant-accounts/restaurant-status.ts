import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { EMPTY, catchError, switchMap, tap } from 'rxjs';
import { AdminCatalogService } from '../../../core/services/admin/admin-catalog.service';
import { KycState } from '../../../core/services/admin/admin-restaurant-accounts.service';
import { NotificationService } from '../../../core/services/notification.service';
import { confirmed } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { errorMessage } from '../../../shared/utils/api-error';
import { RestaurantStatus } from '../../../core/models/catalog.models';

/** What an admin can do to a restaurant in each status (review page and Restaurant accounts). */
export interface StatusAction {
  status: RestaurantStatus;
  label: string;
  icon: string;
  needsReason: boolean;
  danger: boolean;
}

export const RESTAURANT_ACTIONS: Record<RestaurantStatus, StatusAction[]> = {
  pending: [
    {
      status: 'approved',
      label: 'Approve',
      icon: 'check_circle',
      needsReason: false,
      danger: false,
    },
    {
      status: 'resubmission_requested',
      label: 'Ask for documents',
      icon: 'upload',
      needsReason: true,
      danger: false,
    },
    { status: 'rejected', label: 'Reject', icon: 'cancel', needsReason: true, danger: true },
  ],
  // The owner is fixing documents; they can still be approved or rejected meanwhile.
  resubmission_requested: [
    {
      status: 'approved',
      label: 'Approve',
      icon: 'check_circle',
      needsReason: false,
      danger: false,
    },
    { status: 'rejected', label: 'Reject', icon: 'cancel', needsReason: true, danger: true },
  ],
  approved: [
    { status: 'suspended', label: 'Suspend', icon: 'block', needsReason: true, danger: true },
  ],
  suspended: [
    {
      status: 'approved',
      label: 'Reinstate',
      icon: 'restart_alt',
      needsReason: false,
      danger: false,
    },
  ],
  rejected: [
    {
      status: 'approved',
      label: 'Approve anyway',
      icon: 'check_circle',
      needsReason: false,
      danger: false,
    },
  ],
};

const HIDDEN = 'The restaurant will be hidden from customers. The owner will see your reason.';
export const CONFIRM_TEXT: Record<RestaurantStatus, string> = {
  approved: 'The restaurant will become visible to customers.',
  resubmission_requested:
    'The owner is asked to fix what you describe and send the restaurant for review again.',
  rejected: HIDDEN,
  suspended: HIDDEN,
  pending: '',
};

/** Status names as people read them. */
export const RESTAURANT_STATUS_LABEL: Record<RestaurantStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
  resubmission_requested: 'Documents needed',
};

export const RESTAURANT_STATUS_TONE: Record<RestaurantStatus, string> = {
  pending: 'tone-info',
  approved: 'tone-good',
  rejected: 'tone-bad',
  suspended: 'tone-bad',
  resubmission_requested: 'tone-warn',
};

/** A partner's KYC as one word (Restaurant and Delivery partner accounts). */
export const KYC_META: Record<KycState, { label: string; tone: string }> = {
  verified: { label: 'Verified', tone: 'tone-good' },
  pending: { label: 'Awaiting review', tone: 'tone-info' },
  incomplete: { label: 'Incomplete', tone: 'tone-warn' },
  rejected: { label: 'Rejected', tone: 'tone-bad' },
};

/** A table pill: "KYC awaiting review". */
export const kycStatusBadge = (status: KycState) => ({
  label: `KYC ${KYC_META[status].label.toLowerCase()}`,
  tone: KYC_META[status].tone,
});

/** The profile's "KYC & bank" tab badge: nothing once verified. */
export const kycBadge = (status: KycState | undefined) => (status && status !== 'verified' ? KYC_META[status].label : undefined);

/**
 * `change(restaurant, action, stale?)`: asks (with a reason when the action needs one, shown to the
 * owner), then sets the restaurant's status and says how it went. Emits the updated restaurant;
 * nothing if cancelled or it failed (a 409, someone else changed it first, also calls `stale`).
 * Call in an injection context (the Restaurants list and a restaurant's page).
 */
export function restaurantStatusChanger() {
  const dialog = inject(BbDialog);
  const api = inject(AdminCatalogService);
  const notify = inject(NotificationService);
  return (r: { id: string; name: string }, action: StatusAction, stale?: () => void) =>
    confirmed(
      dialog,
      {
        title: `${action.label} ${r.name}?`,
        message: CONFIRM_TEXT[action.status],
        confirmLabel: action.label,
        danger: action.danger,
        reasonLabel: action.needsReason ? 'Reason (shown to the restaurant owner)' : undefined,
      },
      '460px',
    ).pipe(
      switchMap((result) =>
        api.setRestaurantStatus(r.id, action.status, typeof result === 'string' ? result : undefined),
      ),
      tap((updated) => notify.success(`${updated.name} is now ${updated.status}`)),
      catchError((err: unknown) => {
        notify.error(errorMessage(err));
        if (err instanceof HttpErrorResponse && err.status === 409) stale?.();
        return EMPTY;
      }),
    );
}
