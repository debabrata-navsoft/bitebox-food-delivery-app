import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { SelectComponent, SelectOption, TextInputComponent } from 'nexprime';
import { FilteredList } from '../../list/filtered-list';
import { FilterPanel } from '../filter-panel/filter-panel';
import { FilterSection } from '../filter-panel/filter-panel.models';

/**
 * The toolbar of a `filteredList`: the search box, the Filters panel (its button and chips) and,
 * with `sortOptions`, the sort order.
 */
@Component({
  selector: 'bb-list-toolbar',
  imports: [FormField, TextInputComponent, SelectComponent, FilterPanel],
  templateUrl: './list-toolbar.html',
  styleUrl: './list-toolbar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListToolbar {
  readonly list = input.required<Pick<FilteredList, 'toolbar' | 'panel' | 'preview'>>();
  readonly sections = input.required<FilterSection[]>();
  readonly searchLabel = input.required<string>();
  readonly placeholder = input.required<string>();
  readonly sortOptions = input<SelectOption[]>();
}
