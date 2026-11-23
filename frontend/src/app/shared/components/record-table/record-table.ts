import { ChangeDetectionStrategy, Component, OnInit, input } from '@angular/core';
import { Observable } from 'rxjs';
import { pagedList } from '../../list/paged-list';
import { DataTable, TableColumn } from '../data-table/data-table';
import { Paginated } from '../../../core/models/api.models';
import { Permission } from '../../../core/models/user.models';

/** A record tab of an account profile: who may see it, how it loads, its columns. */
export interface ListTab<T = never> {
  id: string;
  label: string;
  /** The area's own permission (the API checks it too). */
  needs?: Permission;
  empty: string;
  fetch: (page: number, limit: number) => Observable<Paginated<T>>;
  columns: TableColumn<T>[];
  /** Rows open something (an order, a ticket). */
  open?: (row: T) => void;
}

/** Record tabs of different kinds of rows side by side (each is typed where it is built). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyListTab = ListTab<any>;

/**
 * A paged table of one record list (an account's orders, payments, coins, tickets...): the tab's
 * columns on bb-data-table (loading, empty and error states, np-pagination). With an `open`, rows
 * are clickable (and focusable: Enter opens them too).
 */
@Component({
  selector: 'bb-record-table',
  imports: [DataTable],
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
}
