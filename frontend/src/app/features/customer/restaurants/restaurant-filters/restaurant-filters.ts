import { RestaurantQuery, RestaurantSort } from '../../../../core/models/catalog.models';

/** The filters a customer can pick on the Restaurants page (kept in the URL's query). */
export interface RestaurantFilters {
  sort: RestaurantSort | null;
  /** A food category's id (one at a time). */
  category: string | null;
  cuisines: string[];
  minRating: number | null;
  cost: CostBand | null;
  veg: boolean;
  openNow: boolean;
  offers: boolean;
}

export type CostBand = 'under300' | '300to600' | 'over600';

/** Cost for two bands, in paise. */
export const COST_BANDS: Record<CostBand, { label: string; min?: number; max?: number }> = {
  under300: { label: 'Under ₹300', max: 30000 },
  '300to600': { label: '₹300 – ₹600', min: 30000, max: 60000 },
  over600: { label: 'Over ₹600', min: 60000 },
};

export const RATINGS = [4.5, 4, 3.5];

export const SORT_LABELS: Record<RestaurantSort, string> = {
  rating: 'Top rated',
  fastest: 'Fastest prep',
  costLow: 'Cost: low to high',
  costHigh: 'Cost: high to low',
  newest: 'Newest',
  distance: 'Nearest',
};

export const NO_FILTERS: RestaurantFilters = {
  sort: null,
  category: null,
  cuisines: [],
  minRating: null,
  cost: null,
  veg: false,
  openNow: false,
  offers: false,
};

/** How many filters are on (the Filters button's count; sort does not count). */
export const activeCount = (f: RestaurantFilters): number =>
  f.cuisines.length +
  [f.category, f.minRating, f.cost, f.veg, f.openNow, f.offers].filter(Boolean).length;

/** The URL's query params for these filters (null removes one). */
export const toParams = (f: RestaurantFilters): Record<string, string | null> => ({
  sort: f.sort,
  category: f.category,
  cuisine: f.cuisines.length ? f.cuisines.join(',') : null,
  rating: f.minRating ? String(f.minRating) : null,
  cost: f.cost,
  veg: f.veg ? 'true' : null,
  open: f.openNow ? 'true' : null,
  offers: f.offers ? 'true' : null,
});

/** The API query for these filters. */
export const toQuery = (f: RestaurantFilters): Partial<RestaurantQuery> => ({
  sort: f.sort ?? undefined,
  category: f.category ?? undefined,
  cuisine: f.cuisines.join(',') || undefined,
  minRating: f.minRating ?? undefined,
  costMin: f.cost ? COST_BANDS[f.cost].min : undefined,
  costMax: f.cost ? COST_BANDS[f.cost].max : undefined,
  veg: f.veg || undefined,
  openNow: f.openNow || undefined,
  offers: f.offers || undefined,
});
