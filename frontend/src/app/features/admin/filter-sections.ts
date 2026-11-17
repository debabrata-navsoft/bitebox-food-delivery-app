import { SelectOption } from 'nexprime';
import { FilterSection } from '../../shared/components/filter-panel/filter-panel.models';
import { filterOptions } from '../../shared/list/filtered-list';
import { VEHICLE_LABEL } from '../../shared/models/checkout.models';
import { ADMIN_ROLES, ROLE_META, USER_STATUS_META } from '../../shared/models/user.models';
import { KYC_META } from './restaurant-accounts/restaurant-status';

// Filters panel sections and sort orders that several admin lists share.

/** An account's status (active, suspended…) under the list's own parameter and label. */
export const accountStatusSection = (key: string, label: string): FilterSection => ({
  kind: 'options',
  key,
  label,
  options: filterOptions(USER_STATUS_META),
});

export const adminRoleSection = (label: string): FilterSection => ({
  kind: 'options',
  key: 'role',
  label,
  options: filterOptions(ROLE_META, ADMIN_ROLES),
});

export const KYC_SECTION: FilterSection = { kind: 'options', key: 'kyc', label: 'KYC status', options: filterOptions(KYC_META) };

export const JOINED_SECTION: FilterSection = { kind: 'dates', key: 'joined', label: 'Joined' };

export const RIDER_AVAILABILITY_SECTION: FilterSection = {
  kind: 'options',
  key: 'availability',
  label: 'Availability',
  options: filterOptions({ online: 'Online', busy: 'On a delivery', offline: 'Offline' }),
};

export const VEHICLE_SECTION: FilterSection = {
  kind: 'options',
  key: 'vehicleType',
  label: 'Vehicle',
  options: filterOptions(VEHICLE_LABEL),
};

/** Zones come from the riders themselves (the API's counts). */
export const ZONE_SECTION: FilterSection = { kind: 'options', key: 'zone', label: 'Delivery zone' };

/** Newest, oldest and A–Z first, then the list's own orders. */
export const accountSorts = (more: Record<string, string>): SelectOption[] =>
  filterOptions({ newest: 'Newest first', oldest: 'Oldest first', name: 'Name A–Z', ...more });
