import { ChangeDetectionStrategy, Component, OnInit, input } from '@angular/core';
import { IconComponent, PaginationComponent } from 'nexprime';
import { Observable } from 'rxjs';
import { pagedList } from '../../list/paged-list';
import { TableLabels } from '../../list/table-labels';
import { Paginated } from '../../models/api.models';
import { Permission } from '../../models/user.models';

/** One column: its text (and an optional second line), or a coloured badge. */
export interface RecordColumn<T> {
  label: string;
  text?: (row: T) => string | number | null | undefined;
  sub?: (row: T) => string | null | undefined;
  badge?: (row: T) => { label: string; tone?: string } | null;
  /** Right-aligned numbers (amounts, counts). */
  num?: boolean;
}

/** A record tab of an account profile: who may see it, how it loads, its columns. */
export interface ListTab<T = never> {
  id: string;
  label: string;
  /** The area's own permission (the API checks it too). */
  needs?: Permission;
  empty: string;
  fetch: (page: number, limit: number) => Observable<Paginated<T>>;
  columns: RecordColumn<T>[];
  /** Rows open something (an order, a ticket). */
  open?: (row: T) => void;
}

/** Record tabs of different kinds of rows side by side (each is typed where it is built). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyListTab = ListTab<any>;

/**
 * A paged table of one record list (an account's orders, payments, coins, tickets...): loading,
 * empty and error states, and np-pagination. Rows open the tab's `open` when it has one.
 */
@Component({
  selector: 'bb-record-table',
  imports: [IconComponent, PaginationComponent, TableLabels],
  templateUrl: './record-table.html',
  styleUrl: './record-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordTable<T> implements OnInit {
  readonly tab = input.required<ListTab<T>>();
  readonly label = input.required<string>();

  protected readonly list = pagedList((page, limit) => this.tab().fetch(page, limit), {
    lazy: true,
    limit: 10,
    errorText: 'Could not load this list.',
  });

  ngOnInit(): void {
    this.list.load(1);
  }

  protected rows(): T[] {
    return (this.list.data()?.items ?? []) as T[];
  }
}
