import { AuditEntry } from '../../../core/models/admin-roles.models';
import { formatPaise } from '../../../shared/pipes/money.pipes';

/** Only the names the generic rule gets wrong ("fssaiNumber" → "FSSAI number", not "Fssai number"). */
const FIELD_LABELS: Record<string, string> = {
  minOrderPaise: 'Minimum order',
  avgPrepTimeMinutes: 'Prep time (min)',
  isAcceptingOrders: 'Taking orders',
  fssaiNumber: 'FSSAI number',
  gstNumber: 'GST number',
  panNumber: 'PAN number',
  imageUrl: 'Photo',
  postalCode: 'PIN code',
  line1: 'Address line 1',
  line2: 'Address line 2',
  basisPoints: 'Commission',
};

/** Only the record types the generic rule gets wrong ("kyc_document" → "KYC document"). */
const RESOURCE_TYPES: Record<string, string> = {
  user: 'Account',
  food: 'Menu item',
  kyc_document: 'KYC document',
  ticket: 'Support ticket',
  reward_campaign: 'Campaign',
  reward_configuration: 'Rewards settings',
  notification_delivery: 'Notification',
};

/** "costForTwoPaise" → "Cost for two", "isPureVeg" → "Pure veg", "dispatch_settings" → "Dispatch settings". */
const humanize = (name: string): string => {
  const words = name
    .replace(/Paise$/, '')
    .replace(/^is(?=[A-Z])/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const fieldLabel = (field: string): string => FIELD_LABELS[field] ?? humanize(field);
export const resourceTypeLabel = (type: string): string => RESOURCE_TYPES[type] ?? humanize(type);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/;

/** One value for people: money in ₹, Yes/No, dates, "orders:view" → "Orders · view". */
export function formatValue(field: string, v: unknown): string {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '—';
  if (field.endsWith('Paise') && typeof v === 'number') return formatPaise(v);
  if (field === 'basisPoints' && typeof v === 'number') return `${v / 100}%`;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v))
    return v.length > 4 ? `${v.length} items` : v.map((x) => formatValue('', x)).join(', ');
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 60);
  const text = String(v);
  if (ISO_DATE.test(text)) {
    const d = new Date(text);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }
  }
  if (/^[a-z]+:[a-z_]+$/.test(text)) {
    const [area, what] = text.split(':');
    return `${area.charAt(0).toUpperCase()}${area.slice(1)} · ${what.replace(/_/g, ' ')}`;
  }
  if (/^[a-z]+(_[a-z]+)+$/.test(text)) return text.replace(/_/g, ' ');
  return text;
}

/** One change, ready to show: old → new, or for lists what was added and removed. */
export interface ChangeItem {
  label: string;
  from?: string;
  to?: string;
  added?: string[];
  removed?: string[];
}

export function changeItems(e: Pick<AuditEntry, 'changes'>): ChangeItem[] {
  return Object.entries(e.changes ?? {}).map(([field, c]) => {
    const label = fieldLabel(field);
    if (!c || typeof c !== 'object' || !('from' in c)) return { label, to: formatValue(field, c) };
    const { from, to } = c as { from: unknown; to: unknown };
    // Lists (e.g. permissions): what was added and removed reads better than two long lists.
    if (Array.isArray(from) || Array.isArray(to)) {
      const before = (Array.isArray(from) ? from : []).map(String);
      const after = (Array.isArray(to) ? to : []).map(String);
      return {
        label,
        added: after.filter((x) => !before.includes(x)).map((x) => formatValue('', x)),
        removed: before.filter((x) => !after.includes(x)).map((x) => formatValue('', x)),
      };
    }
    return { label, from: formatValue(field, from), to: formatValue(field, to) };
  });
}

/** The same as one line each ("Cost for two: ₹300 → ₹1,200", "Permissions: + Orders · view"). */
export const changeLines = (e: Pick<AuditEntry, 'changes'>): string[] =>
  changeItems(e).map((c) => {
    if (c.added || c.removed) {
      const parts = [
        ...(c.added ?? []).map((x) => `+ ${x}`),
        ...(c.removed ?? []).map((x) => `− ${x}`),
      ];
      return `${c.label}: ${parts.length ? parts.join(', ') : 'no change'}`;
    }
    return c.from === undefined ? `${c.label}: ${c.to}` : `${c.label}: ${c.from} → ${c.to}`;
  });
