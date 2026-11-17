import { KycState } from '../../../core/services/admin/admin-restaurant-accounts.service';
import { RestaurantStatus } from '../../../shared/models/catalog.models';

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

/** The profile's "KYC & bank" tab badge: nothing once verified. */
export const kycBadge = (status: KycState | undefined) => (status && status !== 'verified' ? KYC_META[status].label : undefined);
