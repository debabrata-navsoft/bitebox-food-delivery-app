import { computed, signal } from '@angular/core';
import { form } from '@angular/forms/signals';
import { SelectOption } from 'nexprime';
import { Observable } from 'rxjs';
import { isoDay } from '../../shared/forms/dates';
import { pagedList } from '../../shared/list/paged-list';
import { Paginated } from '../../shared/models/api.models';

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

/** Filters every Account management list has. */
interface AccountFilters {
  search: string;
  joinedFrom: Date | null;
  joinedTo: Date | null;
  sort: string;
}

/** The API query for a filter model: blanks dropped, dates as "YYYY-MM-DD". */
type QueryOf<F> = { [K in keyof F]?: F[K] extends Date | null ? string : Exclude<F[K], ''> };

/**
 * An Account management list (Customers, Restaurant and Delivery partner accounts): the filter
 * form, the server query built from it, the paged list, and clearing. Call in an injection context.
 */
export function accountList<F extends AccountFilters, R>(
  blank: F,
  fetch: (query: QueryOf<F> & { page: number; limit: number }) => Observable<Paginated<R>>,
  errorText: string,
) {
  const model = signal({ ...blank });
  const filters = form(model);
  const query = computed(
    () =>
      Object.fromEntries(
        Object.entries(model()).map(([k, v]) => [
          k,
          v instanceof Date ? isoDay(v) : (typeof v === 'string' ? v.trim() : v) || undefined,
        ]),
      ) as QueryOf<F>,
  );
  return {
    filters,
    list: pagedList((page, limit) => fetch({ ...query(), page, limit }), {
      filterKey: () => JSON.stringify(query()),
      errorText,
    }),
    /** Anything but the sort order is set. */
    filtered: computed(() => Object.values(query()).filter(Boolean).length > 1),
    clear: () => {
      filters().reset();
      model.set({ ...blank });
    },
  };
}
