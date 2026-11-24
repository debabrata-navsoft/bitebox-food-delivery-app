import type { MenuItem } from 'nexprime';
import { Pagination } from '../../../core/models/api.models';

/** A link target for `routerLink`: a path or its segments. */
export type TableLink = string | readonly unknown[];

/**
 * A pill. `tone` is a status tone (`good`, `tone-bad`…: rendered as `bb-badge tone-…`); `class`
 * replaces the classes altogether (e.g. `bb-role-chip role-customer`).
 */
export interface TableBadge {
  label: string;
  tone?: string;
  class?: string;
  title?: string;
}

type Maybe<V> = V | null | undefined;

/**
 * One column, all from data: the page's TS says what each cell shows and the table renders it.
 * A cell shows (in this order, each optional) an avatar, the value (a link with `link`, a button
 * with `run`), the badges, the sub-lines and a monospace tag. With none of them it shows "—".
 */
export interface TableColumn<T> {
  label: string;
  value?: (row: T) => Maybe<string | number>;
  /** The value as money (paise → ₹), right-aligned. */
  paise?: (row: T) => Maybe<number>;
  /** The value as a date (`dateFormat`, default `d MMM y`; `DATE_TIME` for date and time). */
  date?: (row: T) => Maybe<string | Date>;
  dateFormat?: string;
  link?: (row: T) => Maybe<TableLink>;
  /** The value as a link-style button that runs this (e.g. opens a dialog); `link` wins. */
  run?: (row: T) => void;
  /** Smaller muted lines under the value (e.g. an email). */
  sub?: (row: T) => Maybe<string> | readonly Maybe<string>[];
  /** A monospace line, e.g. a short id `#1FCAD6AF`. */
  tag?: (row: T) => Maybe<string>;
  /** A pill, or several stacked. */
  badge?: (row: T) => Maybe<TableBadge> | readonly Maybe<TableBadge>[];
  /**
   * A photo (a broken one falls back), else the initials of `name`, or `icon` when given.
   * `square` for logos.
   */
  avatar?: (row: T) => { name: string; imageUrl?: string | null; icon?: string };
  square?: boolean;
  /** `end` for amounts and counts (money columns are), `center` for short values and badges. */
  align?: 'start' | 'end' | 'center';
  nowrap?: boolean;
  /** The value in bold (e.g. a name or a total). */
  strong?: boolean;
  /** The badges on the value's line (e.g. a name with "You"), not under it. */
  inline?: boolean;
  /** Extra classes on the heading and the cells (e.g. `actions` for a custom buttons column). */
  class?: string;
  /** Keep the heading for screen readers only (e.g. a buttons column). */
  hideLabel?: boolean;
  /** Render this column with the page's `<ng-template bbCell="key" let-row>` instead. */
  key?: string;
}

/** Date formats for `TableColumn.dateFormat`. */
export const DATE_TIME = 'd MMM, h:mm a';
export const DATE_YEAR_TIME = 'd MMM y, h:mm a';

/**
 * A button at the end of each row: a link (`link`), an action (`run`) or a "⋮" button opening a
 * popup menu of `menu` items. Icon-only (the label is its tooltip) unless `text` is set.
 */
export interface TableAction<T> {
  /** Required for icon buttons; on a `text` button, shown before the name when set. */
  icon?: string;
  label: string | ((row: T) => string);
  /** A small labelled button instead of an icon button. */
  text?: boolean;
  /** Red (e.g. Suspend), for rows where this is true. */
  danger?: (row: T) => boolean;
  link?: (row: T) => TableLink;
  run?: (row: T) => void;
  menu?: (row: T) => MenuItem[];
  /** Greyed out for rows where this is true (e.g. while the row saves). */
  disabled?: (row: T) => boolean;
  /** Hidden for rows where this is false (e.g. no permission). */
  show?: (row: T) => boolean;
}

/** What the table needs from a `pagedList` / `filteredList(...).list` (any item type). */
export interface TableSource<T> {
  data(): { items: readonly T[]; pagination?: Pagination } | null;
  loading(): boolean;
  showSkeleton(): boolean;
  empty(): boolean;
  error(): string | null;
  load(page: number): void;
  goTo(page: number, rows?: number): void;
}
