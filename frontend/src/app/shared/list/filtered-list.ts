import { computed, signal } from '@angular/core';
import { form } from '@angular/forms/signals';
import { Observable, map } from 'rxjs';
import {
  FilterOption,
  FilterPreview,
  FilterSection,
  FilterValue,
  countSelected,
} from '../components/filter-panel/filter-panel.models';
import { isoDay } from '../forms/dates';
import { Paginated } from '../models/api.models';
import { OrderEvent } from '../../core/services/realtime.service';
import { pagedList } from './paged-list';

/** A list query: option filters as arrays (sent comma-separated), dates as strings. */
export type ListQuery = Record<string, string | string[] | number | undefined>;
/** A list response with the counts the Filters panel shows (`facets=1`). */
export type Faceted<T> = Paginated<T> & { facets?: FilterPreview['facets'] };

/** Labels (or `{ label }` metas) as Filters panel options, in `keys` order when given. */
export const filterOptions = (
  labels: Record<string, string | { label: string }>,
  keys: readonly string[] = Object.keys(labels),
): FilterOption[] =>
  keys.map((value) => {
    const l = labels[value];
    return { value, label: typeof l === 'string' ? l : l.label };
  });

/**
 * A checkbox section: fixed options from `labels` (or a list), or with none (or a name lookup)
 * the values the API's counts return, e.g. restaurants.
 */
export const optionsSection = (
  key: string,
  label: string,
  labels?:
    Record<string, string | { label: string }> | FilterOption[] | ((value: string) => string),
): FilterSection =>
  typeof labels === 'function'
    ? { kind: 'options', key, label, labelOf: labels }
    : {
        kind: 'options',
        key,
        label,
        options: labels && (Array.isArray(labels) ? labels : filterOptions(labels)),
      };

/** A from/to date section, under `${key}From` / `${key}To` or `params`. */
export const datesSection = (
  key: string,
  label: string,
  params?: [from: string, to: string],
): FilterSection =>
  params ? { kind: 'dates', key, label, params } : { kind: 'dates', key, label };

/**
 * Panel filters as API parameters: option lists as they are, dates as `YYYY-MM-DD` days, or with
 * `instants` as the start of the first and the end of the last local day (ISO timestamps).
 */
export function filtersToQuery(v: FilterValue, instants = false): ListQuery {
  return Object.fromEntries(
    Object.entries(v).flatMap(([key, value]): [string, string | string[]][] => {
      if (Array.isArray(value)) return value.length ? [[key, value]] : [];
      if (!(value instanceof Date)) return [];
      if (!instants) return [[key, isoDay(value)]];
      const end = /(^to|To)$/.test(key); // `to` / `joinedTo`: the end of that day
      const day = new Date(value.getFullYear(), value.getMonth(), value.getDate(), end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
      return [[key, day.toISOString()]];
    }),
  );
}

/**
 * An admin list with the global Filters panel: the search box and sort order (`toolbar`, a Signal
 * Form), the panel's applied filters (`panel`), the paged list, the panel's live preview (total and
 * counts for a draft) and clearing. `list.data()` keeps the response's own type (with any extras,
 * e.g. totals). Call in an injection context.
 */
export function filteredList<P extends Faceted<unknown>>(
  fetch: (query: ListQuery & { page: number; limit: number; facets?: 1 }) => Observable<P>,
  opts: {
    errorText: string;
    sort?: string;
    limit?: number;
    instants?: boolean;
    pollMs?: number;
    /** With `pollMs`: which live order events refresh the list (default: all). */
    when?: (event: OrderEvent) => boolean;
    /** Wait for `list.load(1)`, e.g. until the route's inputs are set (`ngOnInit`). */
    lazy?: boolean;
    /** Fixed parameters outside the panel, e.g. the status tab or a customer from a link. */
    extra?: () => ListQuery;
  },
) {
  const blank = { search: '', sort: opts.sort ?? '' };
  const model = signal({ ...blank });
  const toolbar = form(model);
  const panel = signal<FilterValue>({});
  const base = (filters: FilterValue): ListQuery => ({
    ...opts.extra?.(),
    search: model().search.trim() || undefined,
    sort: model().sort || undefined,
    ...filtersToQuery(filters, opts.instants),
  });
  const query = computed(() => base(panel()));
  return {
    toolbar,
    panel,
    list: pagedList((page, limit) => fetch({ ...query(), page, limit }), {
      filterKey: () => JSON.stringify(query()),
      errorText: opts.errorText,
      limit: opts.limit,
      pollMs: opts.pollMs,
      when: opts.when,
      lazy: opts.lazy,
    }),
    /** Total and per-option counts for the panel's draft (with today's search). */
    preview: (draft: FilterValue): Observable<FilterPreview> =>
      fetch({ ...base(draft), page: 1, limit: 1, facets: 1 }).pipe(
        map((r) => ({ total: r.pagination.total, facets: r.facets ?? {} })),
      ),
    /** A search or a panel filter is on. */
    filtered: computed(() => !!model().search.trim() || countSelected(panel()) > 0),
    clear: () => {
      toolbar().reset();
      model.set({ ...blank });
      panel.set({});
    },
  };
}

export type FilteredList = ReturnType<typeof filteredList>;
