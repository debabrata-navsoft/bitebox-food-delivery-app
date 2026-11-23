import { SelectOption } from 'nexprime';
import { USER_STATUS_META, UserStatus } from '../../core/models/user.models';
import {
  TableAction,
  TableBadge,
  TableColumn,
} from '../../shared/components/data-table/data-table.models';

/** The id customers and support quote: the last 8 characters, as on the profile. */
export const shortId = (id: string) => '#' + id.slice(-8).toUpperCase();

/** A filter select: "any" first, then each label (in `keys` order when given). */
export const selectOptions = (
  all: string,
  labels: Record<string, string | { label: string }>,
  keys = Object.keys(labels),
): SelectOption[] => [
  { value: '', label: all },
  ...keys.map((value) => {
    const l = labels[value];
    return { value, label: typeof l === 'string' ? l : l.label };
  }),
];

/**
 * An account's status pill ("Suspended", the reason as its tooltip). `onlyIfInactive`: nothing
 * for active accounts, else "Account suspended" (beside a name).
 */
export const accountStatusBadge = (
  u: { status: UserStatus; statusReason?: string | null },
  opts: { onlyIfInactive?: boolean } = {},
): TableBadge | null => {
  const meta = USER_STATUS_META[u.status];
  if (opts.onlyIfInactive && u.status === 'active') return null;
  return {
    label: opts.onlyIfInactive ? `Account ${meta.label.toLowerCase()}` : meta.label,
    tone: meta.tone,
    title: u.statusReason ?? '',
  };
};

interface Person {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
}

/** A person: photo or initials, the name linking to `route/<id>`, the email and the short id. */
export const personColumn = <T extends Person>(label: string, route: string): TableColumn<T> => ({
  label,
  avatar: (u) => ({ name: u.name, imageUrl: u.avatarUrl }),
  value: (u) => u.name,
  link: (u) => [route, u.id],
  sub: (u) => u.email,
  tag: (u) => shortId(u.id),
});

/** View (`base/<id>`) and Edit (`base/<id>/edit`, for rows `canEdit` allows) row buttons. */
export const viewEditActions = <T extends { id: string }>(
  base: string,
  canEdit: (row: T) => boolean,
): TableAction<T>[] => [
  { icon: 'eye', label: 'View', link: (r) => [base, r.id] },
  { icon: 'pencil', label: 'Edit', link: (r) => [base, r.id, 'edit'], show: canEdit },
];

type Rating = { average: number; count: number } | null | undefined;

/** "★ 4.3", or null without ratings. */
export const stars = (r: Rating): string | null =>
  r?.count ? `★ ${r.average.toFixed(1)}` : null;

/** The average rating and "N ratings" under it (right-aligned). */
export const ratingColumn = <T>(get: (row: T) => Rating): TableColumn<T> => ({
  label: 'Rating',
  value: (row) => stars(get(row)),
  sub: (row) => {
    const r = get(row);
    return r?.count ? `${r.count} ratings` : null;
  },
  align: 'end',
});
