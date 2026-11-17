import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { filtersToQuery } from '../../list/filtered-list';
import { FilterPanel } from './filter-panel';
import { FilterSection, FilterValue } from './filter-panel.models';

const sections: FilterSection[] = [
  { kind: 'options', key: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'blocked', label: 'Blocked' }] },
  { kind: 'options', key: 'city', label: 'City' },
  { kind: 'dates', key: 'joined', label: 'Joined' },
];

describe('FilterPanel', () => {
  const preview = vi.fn();

  async function create(value: FilterValue = {}) {
    await TestBed.configureTestingModule({ imports: [FilterPanel] }).compileComponents();
    const fixture = TestBed.createComponent(FilterPanel);
    fixture.componentRef.setInput('sections', sections);
    fixture.componentRef.setInput('value', value);
    fixture.componentRef.setInput('preview', preview);
    const applied: FilterValue[] = [];
    fixture.componentInstance.apply.subscribe((v) => applied.push(v));
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement, applied };
  }

  beforeEach(() => {
    preview.mockReset().mockReturnValue(
      of({ total: 7, facets: { status: [{ value: 'active', count: 5 }, { value: 'blocked', count: 2 }], city: [{ value: 'Pune', count: 4 }] } }),
    );
  });

  it('shows applied filters as chips, and a chip × removes that value', async () => {
    const { el, applied } = await create({ status: ['active', 'blocked'] });
    expect(el.querySelector('.trigger')!.textContent).toContain('2');
    expect(el.querySelectorAll('.chip').length).toBe(2);
    el.querySelector<HTMLButtonElement>('.chip-x')!.click();
    expect(applied).toEqual([{ status: ['blocked'] }]);
  });

  it('opens with counts for each option and the total, and Apply sends the draft', async () => {
    const { fixture, el, applied } = await create();
    el.querySelector<HTMLButtonElement>('.trigger')!.click();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 400)); // the preview waits a moment after changes
    await fixture.whenStable();
    expect(preview).toHaveBeenCalledWith({});
    expect(el.querySelector('.total')!.textContent).toContain('7');
    const rows = [...el.querySelectorAll('.option')].map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual(['Active5', 'Blocked2']); // label, then its count
    const cmp = fixture.componentInstance as unknown as { toggleOption(k: string, v: string, on: boolean): void; applyDraft(): void };
    cmp.toggleOption('status', 'blocked', true);
    cmp.toggleOption('city', 'Pune', true);
    cmp.applyDraft();
    expect(applied).toEqual([{ status: ['blocked'], city: ['Pune'] }]);
  });
});

describe('filtersToQuery', () => {
  it('sends option lists as they are and dates as days, or as whole-day instants', () => {
    const v: FilterValue = { status: ['active'], city: [], joinedFrom: new Date(2026, 10, 1), joinedTo: null };
    expect(filtersToQuery(v)).toEqual({ status: ['active'], joinedFrom: '2026-11-01' });
    const q = filtersToQuery({ from: new Date(2026, 10, 1), to: new Date(2026, 10, 2) }, true);
    expect(new Date(q['from'] as string).getHours()).toBe(0);
    expect(new Date(q['to'] as string).getHours()).toBe(23);
  });
});
