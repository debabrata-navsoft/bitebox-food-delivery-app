import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FilteredList } from '../../list/filtered-list';
import { EmptyState } from '../empty-state/empty-state';

/**
 * The empty state of a `filteredList`: `title` (with `message` and the projected actions), or with
 * a search or filter on, `noMatch` (when given), then a "Clear filters" link.
 */
@Component({
  selector: 'bb-list-empty',
  imports: [EmptyState],
  templateUrl: './list-empty.html',
  styleUrl: './list-empty.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `title` is an input; drop the static attribute so the host gets no browser tooltip.
  host: { '[attr.title]': 'null' },
})
export class ListEmpty {
  readonly list = input.required<Pick<FilteredList, 'filtered' | 'clear'>>();
  readonly icon = input.required<string>();
  readonly title = input.required<string>();
  readonly message = input<string>();
  readonly noMatch = input<string>();
  readonly noMatchMessage = input<string>();
}
