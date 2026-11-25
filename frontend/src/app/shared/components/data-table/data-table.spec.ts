import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { DataTable, TableColumn } from './data-table';

interface Row {
  id: string;
  name: string;
  total: number | null;
}

// The API's order: neither ascending nor descending by name.
const ROWS: Row[] = [
  { id: 'b', name: 'Item 2', total: null },
  { id: 'a', name: 'Item 10', total: 500 },
  { id: 'c', name: 'item 1', total: 2500 },
];
const COLUMNS: TableColumn<Row>[] = [
  { label: 'Name', value: (r) => r.name },
  { label: 'Total', paise: (r) => r.total },
  { label: 'Fixed', value: (r) => r.id, sortable: false },
  // Already ascending in the API's order (b, a, c → by this key 1, 2, 3).
  { label: 'Fixed2', badge: (r) => ({ label: { b: 'A', a: 'B', c: 'C' }[r.id]! }) },
];

describe('DataTable sorting', () => {
  function render() {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: { can: () => true } }],
    });
    const fixture = TestBed.createComponent(DataTable<Row>);
    fixture.componentRef.setInput('columns', COLUMNS);
    fixture.componentRef.setInput('rows', ROWS);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const firstColumn = () =>
      [...el.querySelectorAll('tbody tr td:first-child')].map((td) => td.textContent?.trim());
    const header = (label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('th button.sort')].find(
        (b) => b.textContent?.trim() === label,
      );
    const click = (label: string) => {
      header(label)!.click();
      fixture.detectChanges();
    };
    return { el, firstColumn, header, click };
  }

  it('flips between ascending and descending, comparing numbers inside text naturally', () => {
    const t = render();
    // Like every column: hover shows ↑, so the first click gives descending (a visible change).
    t.click('Name');
    expect(t.firstColumn()).toEqual(['Item 10', 'Item 2', 'item 1']);
    expect(t.el.querySelector('th[aria-sort="descending"]')).not.toBeNull();
    t.click('Name');
    expect(t.firstColumn()).toEqual(['item 1', 'Item 2', 'Item 10']);
    expect(t.el.querySelector('th[aria-sort="ascending"]')).not.toBeNull();
    t.click('Name');
    expect(t.firstColumn()).toEqual(['Item 10', 'Item 2', 'item 1']); // descending again
  });

  it('shows no arrow until a column is clicked, then keeps it there', () => {
    const t = render();
    expect(t.el.querySelectorAll('th np-icon.on').length).toBe(0);
    t.click('Name');
    expect(t.el.querySelectorAll('th np-icon.on').length).toBe(1);
  });

  it('goes straight to descending when the rows already come in ascending order', () => {
    const t = render();
    t.click('Fixed2');
    expect(t.el.querySelector('th[aria-sort="descending"]')).not.toBeNull();
    expect(t.firstColumn()).toEqual(['item 1', 'Item 10', 'Item 2']);
  });

  it('sorts money by value with empty cells last, and skips columns that opt out', () => {
    const t = render();
    t.click('Total');
    expect(t.firstColumn()).toEqual(['item 1', 'Item 10', 'Item 2']); // ₹25, ₹5, empty
    t.click('Total');
    expect(t.firstColumn()).toEqual(['Item 10', 'item 1', 'Item 2']); // ₹5, ₹25, empty
    expect(t.header('Fixed')).toBeUndefined();
  });
});
