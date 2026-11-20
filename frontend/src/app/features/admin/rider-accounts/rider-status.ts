import { RiderVerificationStatus } from '../../../core/models/order-management.models';

/** Verification decisions an admin can make for a rider in each status (review page and Delivery partner accounts). */
/** Anything but approving needs a reason, which the rider sees. */
export interface Decision {
  status: Exclude<RiderVerificationStatus, 'pending'>;
  label: string;
  message: string;
  danger?: boolean;
}

const APPROVE: Decision = {
  status: 'approved',
  label: 'Approve',
  message: 'The rider can go online and receive deliveries.',
};
const ASK: Decision = {
  status: 'resubmission_requested',
  label: 'Ask for documents',
  message: 'The rider is told what to fix and cannot go online until approved again.',
};
const REJECT: Decision = {
  status: 'rejected',
  label: 'Reject',
  message: 'The rider cannot go online. They see your reason.',
  danger: true,
};
export const DECISIONS: Record<RiderVerificationStatus, Decision[]> = {
  pending: [APPROVE, ASK, REJECT],
  resubmission_requested: [APPROVE, REJECT],
  rejected: [APPROVE],
  approved: [ASK],
};

/** "Online", "On a delivery" or "Offline". */
export const availabilityOf = (r: { isOnline: boolean; busy?: boolean }) =>
  r.busy ? { label: 'On a delivery', tone: 'tone-info' } : r.isOnline ? { label: 'Online', tone: 'tone-good' } : { label: 'Offline', tone: '' };
