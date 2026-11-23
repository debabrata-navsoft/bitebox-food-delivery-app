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

/** "status: active → suspended · name: Asha → Asha V." (lists and objects shortened). */
const show = (v: unknown): string =>
  v == null || v === '' || (Array.isArray(v) && !v.length) ? '—' : Array.isArray(v) ? (v.length > 4 ? `${v.length} items` : v.join(', ')) : typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v);
export const changeLines = (e: AuditEntry): string[] =>
  Object.entries(e.changes ?? {}).map(([field, c]) =>
    c && typeof c === 'object' && 'from' in c ? `${field}: ${show(c.from)} → ${show(c.to)}` : `${field}: ${show(c)}`,
  );

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
  protected readonly changeLines = changeLines;

  protected readonly filterSections: FilterSection[] = [
    // The actions that were recorded (the API's counts), by their label.
    { kind: 'options', key: 'action', label: 'Action', labelOf: (a) => ACTIONS[a] ?? a },
    adminRoleSection('Admin role'),
    { kind: 'options', key: 'accountType', label: 'Account type', options: filterOptions(ACCOUNT_TYPES) },
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
      sub: (e) => ROLE_META[e.adminRole]?.label ?? e.adminRole,
    },
    {
      label: 'Action',
      badge: (e) => ({ label: ACTIONS[e.action] ?? e.action, tone: 'info' }),
      sub: (e) => [e.description, e.reason ? `Reason: ${e.reason}` : null],
    },
    // The account type and the short id, linking to its page (or the record's type and id).
    {
      label: 'Account',
      badge: (e) => (e.accountType ? { label: ACCOUNT_TYPES[e.accountType] ?? e.accountType } : null),
      value: (e) => (e.resourceId && accountLink(e) ? shortId(e.resourceId) : null),
      link: accountLink,
      tag: (e) => (e.resourceId && !accountLink(e) ? `${e.resourceType} ${shortId(e.resourceId)}` : null),
    },
    // "field: old → new" lines and the IP address.
    { label: 'Changes', key: 'changes' },
  ];
}
