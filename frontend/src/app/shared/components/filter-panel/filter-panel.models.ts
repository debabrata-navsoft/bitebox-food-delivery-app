/** One option of a Filters panel section: the API value and what people read. */
export interface FilterOption {
  value: string;
  label: string;
}

/**
 * A section of the Filters panel: checkboxes (`options`; with no fixed `options` the values come
 * from the API's counts, e.g. cities) or a date range (`dates`, stored under `${key}From`/`${key}To`).
 */
export type FilterSection =
  | { kind: 'options'; key: string; label: string; options?: FilterOption[]; labelOf?: (value: string) => string }
  | { kind: 'dates'; key: string; label: string; params?: [from: string, to: string] };

/** Where a date section keeps its range: `params`, or `${key}From` / `${key}To` (e.g. joinedFrom). */
export const dateKeys = (s: { key: string; params?: [string, string] }): [string, string] =>
  s.params ?? [`${s.key}From`, `${s.key}To`];

/** The panel's selection: option sections → chosen values; date sections → their two date keys. */
export type FilterValue = Record<string, string[] | Date | null>;

/** What the API says about a selection: the total, and per section how many each option gives. */
export interface FilterPreview {
  total: number;
  /** Id facets (restaurant, category) also carry the name to show. */
  facets: Record<string, { value: string; count: number; label?: string }[]>;
}

/** Selected values, dates kept as they are. */
export const countSelected = (value: FilterValue): number =>
  Object.values(value).reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : v ? 1 : 0), 0);
