import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { IconComponent, ToggleComponent } from 'nexprime';
import { RestaurantSort } from '../../../../../core/models/catalog.models';
import {
  BB_DIALOG_DATA,
  BbDialog,
  BbDialogRef,
  BbDialogTitle,
} from '../../../../../shared/dialog/bb-dialog';
import {
  COST_BANDS,
  CostBand,
  NO_FILTERS,
  activeCount,
  RATINGS,
  RestaurantFilters,
  SORT_LABELS,
} from '../restaurant-filters';

export interface FiltersDialogData {
  filters: RestaurantFilters;
  cuisines: string[];
  categories: { id: string; name: string }[];
  /** A delivery location is set (so "Nearest" can sort). */
  nearby: boolean;
  /** The tab to open on. */
  tab?: Tab;
}

type Tab = 'sort' | 'category' | 'cuisines' | 'rating' | 'cost' | 'more';

/** One choice in a single-choice tab. */
interface Choice {
  value: string;
  label: string;
  icon?: string;
}

const SORT_ICONS: Record<RestaurantSort, string> = {
  rating: 'star',
  fastest: 'timer',
  costLow: 'arrow-up-narrow-wide',
  costHigh: 'arrow-down-wide-narrow',
  newest: 'sparkles',
  distance: 'navigation',
};

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'sort', label: 'Sort by', icon: 'arrow-down-up' },
  { id: 'category', label: 'Category', icon: 'layout-grid' },
  { id: 'cuisines', label: 'Cuisines', icon: 'utensils' },
  { id: 'rating', label: 'Rating', icon: 'star' },
  { id: 'cost', label: 'Cost for two', icon: 'wallet' },
  { id: 'more', label: 'More filters', icon: 'sliders-horizontal' },
];

/** The yes/no filters under "More filters". */
const SWITCHES = [
  { key: 'veg', label: 'Pure veg', hint: 'Only vegetarian restaurants', icon: 'leaf' },
  { key: 'openNow', label: 'Open now', hint: 'Taking orders right now', icon: 'clock' },
  { key: 'offers', label: 'Offers', hint: 'Restaurants with a live offer', icon: 'badge-percent' },
] as const;

/**
 * Restaurant filters: tabs on the left (sort, cuisines, rating, cost for two, more), the choices on
 * the right; Apply returns them, Clear all empties them. Nothing changes until Apply.
 */
@Component({
  selector: 'bb-filters-dialog',
  imports: [BbDialogTitle, IconComponent, ToggleComponent],
  templateUrl: './filters-dialog.html',
  styleUrl: './filters-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiltersDialog {
  protected readonly data = inject<FiltersDialogData>(BB_DIALOG_DATA);
  protected readonly ref = inject<BbDialogRef<RestaurantFilters>>(BbDialogRef);

  /** The choices so far (applied only on Apply). */
  protected readonly draft = signal<RestaurantFilters>({ ...this.data.filters });
  protected readonly tab = signal<Tab>(this.data.tab ?? 'sort');

  protected readonly switches = SWITCHES;

  /** The choices of each single-choice tab ('' means "any"). */
  protected readonly choices: Partial<Record<Tab, Choice[]>> = {
    sort: (Object.keys(SORT_LABELS) as RestaurantSort[])
      .filter((s) => s !== 'distance' || this.data.nearby)
      .map((value) => ({ value, label: SORT_LABELS[value], icon: SORT_ICONS[value] })),
    category: [
      { value: '', label: 'All' },
      ...this.data.categories.map((c) => ({ value: c.id, label: c.name })),
    ],
    rating: [
      { value: '', label: 'Any', icon: 'star' },
      ...RATINGS.map((r) => ({ value: String(r), label: `${r}+`, icon: 'star' })),
    ],
    cost: [
      { value: '', label: 'Any cost', icon: 'wallet' },
      ...(Object.keys(COST_BANDS) as CostBand[]).map((value) => ({
        value,
        label: COST_BANDS[value].label,
        icon: 'indian-rupee',
      })),
    ],
  };

  /** The value chosen in a single-choice tab, as a string. */
  protected readonly chosen = computed(() => {
    const d = this.draft();
    return {
      sort: d.sort ?? (this.data.nearby ? 'distance' : 'rating'),
      category: d.category ?? '',
      rating: d.minRating ? String(d.minRating) : '',
      cost: d.cost ?? '',
    } as Partial<Record<Tab, string>>;
  });

  protected readonly count = computed(() => activeCount(this.draft()));

  /** The tabs, each with what is chosen in it (shown under its name). */
  protected readonly tabs = computed(() => {
    const d = this.draft();
    const chosen = this.chosen();
    return TABS.map((t) => ({
      ...t,
      picked:
        t.id === 'cuisines'
          ? d.cuisines.length
            ? `${d.cuisines.length} selected`
            : ''
          : t.id === 'more'
            ? SWITCHES.filter((w) => d[w.key])
                .map((w) => w.label)
                .join(', ')
            : (chosen[t.id] && this.choices[t.id]?.find((c) => c.value === chosen[t.id])?.label) ||
              '',
    }));
  });

  protected set<K extends keyof RestaurantFilters>(key: K, value: RestaurantFilters[K]): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  /** Picks a choice in a single-choice tab. */
  protected choose(tab: Tab, value: string): void {
    const change: Partial<Record<Tab, Partial<RestaurantFilters>>> = {
      sort: { sort: value as RestaurantSort },
      category: { category: value || null },
      rating: { minRating: value ? +value : null },
      cost: { cost: (value || null) as CostBand | null },
    };
    this.draft.update((d) => ({ ...d, ...change[tab] }));
  }

  protected toggleCuisine(name: string, on: boolean): void {
    this.draft.update((d) => ({
      ...d,
      cuisines: on ? [...d.cuisines, name] : d.cuisines.filter((c) => c !== name),
    }));
  }

  protected clear(): void {
    this.draft.set({ ...NO_FILTERS });
  }

  protected apply(): void {
    this.ref.close(this.draft());
  }
}

/** Opens the filters; emits the chosen filters on Apply. */
export const openFilters = (dialog: BbDialog, data: FiltersDialogData) =>
  dialog.result<FiltersDialog, FiltersDialogData, RestaurantFilters>(FiltersDialog, {
    data,
    width: '720px',
    panelClass: 'bb-filters-panel',
    closeOnOutsideClick: true,
  });
