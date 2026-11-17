import { A11yModule } from '@angular/cdk/a11y';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { CalendarComponent, CheckboxComponent, IconComponent } from 'nexprime';
import { Observable, catchError, of, switchMap, timer } from 'rxjs';
import { FilterOption, FilterPreview, FilterSection, FilterValue, countSelected, dateKeys } from './filter-panel.models';

const LONG_LIST = 6;

/** An applied filter as a chip: one option, or one date range. */
interface Chip {
  section: FilterSection;
  value: string | null;
  from: Date | null;
  to: Date | null;
}

/**
 * The global Filters panel of the admin lists: a "Filters" button (with how many are on), the
 * chosen filters as removable chips, and a side panel with a section per filter. Option sections
 * are checkboxes with how many results each gives (and a search box for long lists); date sections
 * are a from/to range. "Total results" follows the draft selection; Apply sets it, Clear filter
 * empties it. Counts and totals come from `preview` (the list's API with facets).
 */
@Component({
  selector: 'bb-filter-panel',
  imports: [A11yModule, DatePipe, CalendarComponent, CheckboxComponent, IconComponent],
  templateUrl: './filter-panel.html',
  styleUrl: './filter-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'close()' },
})
export class FilterPanel {
  readonly sections = input.required<FilterSection[]>();
  /** The applied filters. */
  readonly value = input.required<FilterValue>();
  readonly preview = input.required<(draft: FilterValue) => Observable<FilterPreview>>();
  readonly apply = output<FilterValue>();

  protected readonly open = signal(false);
  protected readonly draft = signal<FilterValue>({});
  protected readonly expanded = signal<Set<string>>(new Set());
  protected readonly searches = signal<Record<string, string>>({});
  protected readonly active = computed(() => countSelected(this.value()));
  protected readonly dateKeys = dateKeys;
  /** Names of id values (restaurants, categories) seen in the API's counts. */
  private readonly names = new Map<string, string>();

  /** Total and counts for the draft, refreshed a moment after each change while open. */
  private readonly counts = rxResource({
    params: () => (this.open() ? this.draft() : undefined),
    stream: ({ params }) =>
      timer(250).pipe(
        switchMap(() => this.preview()(params)),
        catchError(() => of<FilterPreview | null>(null)),
      ),
  });
  protected readonly total = computed(() => (this.counts.hasValue() ? (this.counts.value()?.total ?? null) : null));

  /** Applied filters as chips: "Status: Active". */
  protected readonly chips = computed(() =>
    this.sections().flatMap((s): Chip[] => {
      const v = this.value();
      if (s.kind === 'dates') {
        const [fromKey, toKey] = dateKeys(s);
        const from = v[fromKey] as Date | null;
        const to = v[toKey] as Date | null;
        return from || to ? [{ section: s, value: null, from, to }] : [];
      }
      return ((v[s.key] as string[] | undefined) ?? []).map((value) => ({ section: s, value, from: null, to: null }));
    }),
  );

  constructor() {
    // Opening starts from what is applied, with the first section open.
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.draft.set(structuredClone(this.value()));
        const first = this.sections()[0];
        this.expanded.set(new Set(first ? [first.key] : []));
        this.searches.set({});
      });
    });
  }

  /** A section's options with their counts, filtered by its search box. */
  protected options(s: FilterSection & { kind: 'options' }): (FilterOption & { count: number | null })[] {
    const facet = this.counts.hasValue() ? this.counts.value()?.facets?.[s.key] : undefined;
    const count = new Map((facet ?? []).map((f) => [f.value, f.count]));
    const base: FilterOption[] =
      s.options ?? (facet ?? []).map((f) => ({ value: f.value, label: f.label ?? s.labelOf?.(f.value) ?? f.value }));
    // Remember names the API gave (chips show them after the panel closes).
    for (const f of facet ?? []) if (f.label) this.names.set(`${s.key}:${f.value}`, f.label);
    // Keep chosen values listed even when the API no longer returns them.
    const chosen = this.selected(s.key).filter((v) => !base.some((o) => o.value === v));
    const all = [...base, ...chosen.map((v) => ({ value: v, label: this.nameOf(s, v) }))];
    const q = (this.searches()[s.key] ?? '').trim().toLowerCase();
    return all
      .filter((o) => !q || o.label.toLowerCase().includes(q))
      .map((o) => ({ ...o, count: facet ? (count.get(o.value) ?? 0) : null }));
  }

  protected searchable(s: FilterSection & { kind: 'options' }): boolean {
    return (s.options?.length ?? Infinity) > LONG_LIST;
  }

  protected selected(key: string): string[] {
    return (this.draft()[key] as string[] | undefined) ?? [];
  }

  protected chosenIn(s: FilterSection): number {
    if (s.kind === 'dates') return dateKeys(s).filter((k) => this.draft()[k]).length;
    return this.selected(s.key).length;
  }

  protected toggleOption(key: string, value: string, on: boolean): void {
    const now = this.selected(key).filter((v) => v !== value);
    this.draft.update((d) => ({ ...d, [key]: on ? [...now, value] : now }));
  }

  protected setDate(key: string, date: Date | null): void {
    this.draft.update((d) => ({ ...d, [key]: date }));
  }


  protected toggleSection(key: string): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  protected search(key: string, text: string): void {
    this.searches.update((s) => ({ ...s, [key]: text }));
  }

  protected clearDraft(): void {
    this.draft.set({});
  }

  protected applyDraft(): void {
    this.apply.emit(this.cleaned(this.draft()));
    this.open.set(false);
  }

  /** A chip's ×: that value (or date range) off, applied at once. */
  protected remove(chip: Chip): void {
    const v = { ...this.value() };
    const s = chip.section;
    if (s.kind === 'dates') for (const k of dateKeys(s)) v[k] = null;
    else v[s.key] = ((v[s.key] as string[]) ?? []).filter((x) => x !== chip.value);
    this.apply.emit(this.cleaned(v));
  }

  protected clearAll(): void {
    this.apply.emit({});
  }

  protected chipLabel(chip: Chip): string {
    const s = chip.section;
    if (s.kind === 'dates' || chip.value === null) return s.label;
    return s.options?.find((o) => o.value === chip.value)?.label ?? this.nameOf(s, chip.value);
  }

  private nameOf(s: FilterSection, value: string): string {
    return this.names.get(`${s.key}:${value}`) ?? (s.kind === 'options' ? s.labelOf?.(value) : undefined) ?? value;
  }

  protected close(): void {
    this.open.set(false);
  }

  private cleaned(v: FilterValue): FilterValue {
    return Object.fromEntries(
      Object.entries(v).filter(([, x]) => (Array.isArray(x) ? x.length : x !== null && x !== undefined)),
    );
  }
}
