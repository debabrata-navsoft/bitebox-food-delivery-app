import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AdminStaffService } from '../../../core/services/admin/admin-staff.service';
import {
  BbCell,
  BbEmpty,
  DATE_YEAR_TIME,
  DataTable,
  TableColumn,
} from '../../../shared/components/data-table/data-table';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { ListToolbar } from '../../../shared/components/list-toolbar/list-toolbar';
import { FilterSection } from '../../../shared/components/filter-panel/filter-panel.models';
import { filterOptions, filteredList } from '../../../shared/list/filtered-list';
import { adminRoleSection } from '../filter-sections';
import { AuditEntry } from '../../../core/models/admin-roles.models';
import { ROLE_META } from '../../../core/models/user.models';
import { shortId } from '../account-list';
import { changeItems, resourceTypeLabel } from './audit-format';

/** Labels for the actions the API records (the `audited(...)` routes of both backends). */
const ACTIONS: Record<string, string> = {
  'admin.create': 'Admin created',
  'admin.update': 'Admin or permissions changed',
  'admin.status': 'Admin status changed',
  'user.status': 'Account status changed',
  'user.update': 'Account details changed',
  'user.address.create': 'Address added',
  'user.address.update': 'Address changed',
  'user.address.default': 'Default address changed',
  'user.address.delete': 'Address deleted',
  'customer.password_reset': 'Password reset link sent',
  'customer.email_verification': 'Verification email sent',
  'restaurant.status': 'Restaurant approval or suspension',
  'restaurant.update': 'Restaurant details changed',
  'restaurant.accepting_orders': 'Restaurant closed or reopened',
  'rider.status': 'Rider account status',
  'rider.update': 'Rider details changed',
  'rider.verification': 'Rider verification',
  'rider.availability': 'Rider taken offline',
  'kyc.document.review': 'KYC document reviewed',
  'kyc.document.view': 'KYC document viewed',
  'commission.set': 'Commission set',
  'commission.clear': 'Commission rule removed',
  'food.delete': 'Menu item deleted',
  'category.delete': 'Category deleted',
  'coupon.create': 'Coupon created',
  'coupon.update': 'Coupon changed',
  'coupon.status': 'Coupon paused or resumed',
  'coupon.duplicate': 'Coupon duplicated',
  'coupon.delete': 'Coupon deleted',
  'offer.approve': 'Restaurant offer approved',
  'offer.reject': 'Restaurant offer rejected',
  'order.cancel': 'Order cancelled',
  'order.assign': 'Rider assigned',
  'order.unassign': 'Rider unassigned',
  'order.delivery_code': 'Delivery code reset',
  'payment.refund': 'Refund retried',
  'payment.partial_refund': 'Partial refund',
  'payment.refund_paid': 'Manual refund marked paid',
  'payout.create': 'Payout created',
  'payout.paid': 'Payout paid',
  'payout.cancel': 'Payout cancelled',
  'review.moderate': 'Review moderated',
  'ticket.update': 'Ticket updated',
  'ticket.escalate': 'Ticket escalated',
  'push.promotion': 'Promotion pushed',
  'notification.retry': 'Notification retried',
  'rewards.configure': 'Rewards settings changed',
  'rewards.reverse': 'Coin transaction reversed',
  'rewards.campaign.create': 'Campaign created',
  'rewards.campaign.update': 'Campaign changed',
  'rewards.campaign.status': 'Campaign status changed',
  'rewards.referral.approve': 'Referral approved',
  'rewards.referral.reject': 'Referral rejected',
};

const ACCOUNT_TYPES: Record<string, string> = {
  customer: 'Customer',
  restaurant: 'Restaurant',
  delivery: 'Delivery partner',
  admin: 'Admin',
};

/** "Restaurant", "Delivery partner", "KYC document"… */
const typeLabel = (e: AuditEntry): string =>
  (e.accountType && ACCOUNT_TYPES[e.accountType]) || resourceTypeLabel(e.resourceType ?? '');

/** Where the changed account lives in the panel, when it has a page there. */
const accountLink = (e: AuditEntry): string[] | null => {
  if (!e.resourceId) return null;
  if (e.resourceType === 'restaurant') return ['/admin/restaurant-accounts', e.resourceId];
  if (e.resourceType !== 'user') return null;
  if (e.accountType === 'customer') return ['/admin/customers', e.resourceId];
  if (e.accountType === 'delivery') return ['/admin/delivery-partner-accounts', e.resourceId];
  if (e.accountType === 'restaurant') return ['/admin/users', e.resourceId];
  return null;
};

/**
 * Every sensitive admin action, newest first: who, what, to which account, the old and new
 * values, the reason and the IP address. Rows can't be changed or removed by anyone.
 */
@Component({
  selector: 'bb-audit-log',
  imports: [ListToolbar, DataTable, BbCell, BbEmpty, EmptyState, PageHeader],
  templateUrl: './audit-log.html',
  styleUrl: './audit-log.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditLogPage {
  private readonly api = inject(AdminStaffService);
  protected readonly changeItems = changeItems;

  protected readonly filterSections: FilterSection[] = [
    // The actions that were recorded (the API's counts), by their label.
    { kind: 'options', key: 'action', label: 'Action', labelOf: (a) => ACTIONS[a] ?? a },
    adminRoleSection('Admin role'),
    {
      kind: 'options',
      key: 'accountType',
      label: 'Account type',
      options: filterOptions(ACCOUNT_TYPES),
    },
    { kind: 'dates', key: 'when', label: 'Date', params: ['from', 'to'] },
  ];
  protected readonly log = filteredList((query) => this.api.auditLog(query), {
    errorText: 'Could not load the audit log.',
    limit: 50,
    instants: true,
  });
  protected readonly list = this.log.list;

  protected readonly columns: TableColumn<AuditEntry>[] = [
    { label: 'When', date: (e) => e.createdAt, dateFormat: DATE_YEAR_TIME, nowrap: true },
    {
      label: 'Admin',
      value: (e) => e.admin?.name ?? 'Removed account',
      strong: true,
      nowrap: true,
      sub: (e) => ROLE_META[e.adminRole]?.label ?? e.adminRole,
    },
    {
      label: 'Action',
      badge: (e) => ({ label: ACTIONS[e.action] ?? e.action, tone: 'info' }),
      sub: (e) => [e.description, e.reason ? `Reason: ${e.reason}` : null],
    },
    // The record's name (linked to its page when it has one), its kind and short id.
    {
      label: 'Account',
      class: 'account',
      // No name (an old entry about a deleted record): the kind tag and the id say enough.
      value: (e) => e.resourceLabel || null,
      strong: true,
      link: accountLink,
      badge: (e) =>
        e.resourceType || e.accountType ? { label: typeLabel(e), tone: 'muted' } : null,
      sub: (e) => (e.resourceId ? shortId(e.resourceId) : null),
    },
    // Each changed field (old → new, or what was added/removed) and the IP address.
    { label: 'Changes', key: 'changes' },
  ];
}
