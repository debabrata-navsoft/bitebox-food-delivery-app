import { TableLabels } from '../../../shared/list/table-labels';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { form } from '@angular/forms/signals';
import { IconComponent, PaginationComponent, SelectOption } from 'nexprime';
import { AdminStaffService } from '../../../core/services/admin/admin-staff.service';
import { EmptyState } from '../../../shared/components/empty-state/empty-state';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { NP_FORM_FIELDS } from '../../../shared/forms/np-form-fields';
import { pagedList } from '../../../shared/list/paged-list';
import { AuditEntry } from '../../../shared/models/admin-roles.models';
import { ADMIN_ROLES, AdminRole, ROLE_META } from '../../../shared/models/user.models';

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
  imports: [
    TableLabels,
    DatePipe,
    RouterLink,
    NP_FORM_FIELDS,
    PaginationComponent,
    IconComponent,
    EmptyState,
    PageHeader,
  ],
  templateUrl: './audit-log.html',
  styleUrl: './audit-log.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditLogPage {
  private readonly api = inject(AdminStaffService);
  protected readonly actionLabel = (a: string) => ACTIONS[a] ?? a;
  protected readonly roleLabel = (r: AdminRole) => ROLE_META[r]?.label ?? r;
  protected readonly accountLabel = (t?: string) => (t ? ACCOUNT_TYPES[t] ?? t : '');
  protected readonly changeLines = changeLines;
  protected readonly accountLink = accountLink;

  protected readonly filterModel = signal({
    search: '',
    action: '',
    role: '',
    accountType: '',
    from: null as Date | null,
    to: null as Date | null,
  });
  protected readonly filters = form(this.filterModel);
  protected readonly actionOptions: SelectOption[] = [
    { value: '', label: 'All actions' },
    ...Object.entries(ACTIONS)
      .sort(([, a], [, b]) => a.localeCompare(b))
      .map(([value, label]) => ({ value, label })),
  ];
  protected readonly roleOptions: SelectOption[] = [
    { value: '', label: 'All admin roles' },
    ...ADMIN_ROLES.map((r) => ({ value: r, label: ROLE_META[r].label })),
  ];
  protected readonly accountOptions: SelectOption[] = [
    { value: '', label: 'Any account type' },
    ...Object.entries(ACCOUNT_TYPES).map(([value, label]) => ({ value, label })),
  ];

  private readonly query = computed(() => {
    const f = this.filterModel();
    const end = f.to && new Date(f.to.getFullYear(), f.to.getMonth(), f.to.getDate(), 23, 59, 59, 999);
    return {
      search: f.search.trim() || undefined,
      action: f.action || undefined,
      role: f.role || undefined,
      accountType: f.accountType || undefined,
      // Whole local days: from the start of the first to the end of the last.
      from: f.from ? new Date(f.from.getFullYear(), f.from.getMonth(), f.from.getDate()).toISOString() : undefined,
      to: end ? end.toISOString() : undefined,
    };
  });

  protected readonly list = pagedList((page, limit) => this.api.auditLog({ ...this.query(), page, limit }), {
    filterKey: () => JSON.stringify(this.query()),
    limit: 50,
    errorText: 'Could not load the audit log.',
  });
}
