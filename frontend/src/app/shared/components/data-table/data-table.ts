import { DatePipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  TemplateRef,
  booleanAttribute,
  computed,
  contentChild,
  contentChildren,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { pagePermission } from '../../../core/auth/admin-pages';
import {
  ButtonComponent,
  IconComponent,
  MenuComponent,
  MenuItem,
  PaginationComponent,
} from 'nexprime';
import { initialsOf } from '../../../core/models/user.models';
import { ImageFallback, UsableImagePipe } from '../../directives/broken-images';
import { TableLabels } from '../../directives/table-labels';
import { DetailOrder } from '../../list/detail-order';
import { FilteredList } from '../../list/filtered-list';
import { formatPaise } from '../../pipes/money.pipes';
import { COMPACT_MENU_WIDTH, toggleEndAligned } from '../../utils/end-aligned-menu';
import { EmptyState } from '../empty-state/empty-state';
import { ListEmpty } from '../list-empty/list-empty';
import { TableAction, TableBadge, TableColumn, TableLink, TableSource } from './data-table.models';

export * from './data-table.models';

/**
 * A custom cell for the column with this `key`: `<ng-template bbCell="checks" [bbCellOf]="list"
 * let-row>` (`bbCellOf`, the table's list or rows, types `row`).
 */
@Directive({ selector: 'ng-template[bbCell]' })
export class BbCell<T = unknown> {
  readonly bbCell = input.required<string>();
  readonly bbCellOf = input<TableSource<T> | readonly T[]>();
  readonly template = inject<TemplateRef<{ $implicit: T }>>(TemplateRef);

  static ngTemplateContextGuard<T>(_d: BbCell<T>, ctx: unknown): ctx is { $implicit: T } {
    return true;
  }
}

/** The page's own empty state, in place of the default: `<ng-template bbEmpty>`. */
@Directive({ selector: 'ng-template[bbEmpty]' })
export class BbEmpty {
  readonly template = inject<TemplateRef<unknown>>(TemplateRef);
}

/** One cell, worked out once per data change (the template only reads it). */
interface CellView {
  custom?: TemplateRef<{ $implicit: unknown }>;
  blank: boolean;
  avatar?: { name: string; imageUrl?: string | null; icon?: string };
  value?: string | number;
  date?: string | Date;
  link?: TableLink;
  run?: () => void;
  badges: { label: string; class: string; title: string }[];
  lines: string[];
  tag?: string;
}

interface ActionView {
  icon: string;
  label: string;
  text: boolean;
  danger: boolean;
  disabled: boolean;
  link?: TableLink;
  run?: () => void;
  menu?: MenuItem[];
}

const present = <V>(v: V | null | undefined | ''): v is V =>
  v !== null && v !== undefined && v !== '';
const list = <V>(v: V | null | undefined | readonly (V | null | undefined)[]): V[] =>
  (Array.isArray(v) ? v : [v]).filter((x): x is V => !!x);
const badgeClass = (b: TableBadge) =>
  b.class ??
  `bb-badge ${b.tone && !b.tone.startsWith('tone-') ? 'tone-' + b.tone : (b.tone ?? '')}`;

/**
 * The shared data table. The page passes data only: `columns` (and `actions`) built in its TS,
 * and the rows as a `list` (a pagedList / filteredList list: error with Retry, loading skeleton,
 * empty state and np-pagination come with it) or a plain `rows` array. Sits in a card unless
 * `card` is false (inside a dialog or a card of the page's own).
 */
@Component({
  selector: 'bb-data-table',
  imports: [
    DatePipe,
    NgTemplateOutlet,
    RouterLink,
    ButtonComponent,
    IconComponent,
    MenuComponent,
    PaginationComponent,
    TableLabels,
    ImageFallback,
    UsableImagePipe,
    EmptyState,
    ListEmpty,
  ],
  templateUrl: './data-table.html',
  styleUrl: './data-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'card() ? "bb-card bb-list-card" : ""', '[attr.aria-busy]': 'busy()' },
})
export class DataTable<T> {
  readonly columns = input.required<readonly TableColumn<T>[]>();
  readonly actions = input<readonly TableAction<T>[]>([]);
  readonly list = input<TableSource<T>>();
  readonly rows = input<readonly T[]>();
  /** With `rows`: dims the table while it refreshes. */
  readonly loading = input(false, { transform: booleanAttribute });
  /** A row's identity, so live refreshes keep its DOM (and an open menu) with it. */
  readonly trackBy = input<(row: T) => unknown>((row) => (row as { id?: unknown }).id ?? row);
  /** The table's accessible name. */
  readonly label = input<string>();
  readonly emptyText = input('Nothing to show yet.');
  readonly emptyIcon = input('inbox');
  /** The page's filteredList: with a search or filter on, the empty state offers "Clear filters". */
  readonly filters = input<Pick<FilteredList, 'filtered' | 'clear'>>();
  readonly card = input(true, { transform: booleanAttribute });
  readonly rowsOptions = input([20, 50, 100]);
  /** Rows the user can click (or open with Enter); `rowClick` fires with the row. */
  readonly clickable = input(false, { transform: booleanAttribute });

  readonly rowClick = output<T>();

  private readonly cellTemplates = contentChildren(BbCell);
  protected readonly emptyTemplate = contentChild(BbEmpty);

  protected readonly items = computed(() => this.list()?.data()?.items ?? this.rows() ?? []);
  protected readonly busy = computed(() => this.list()?.loading() ?? this.loading());
  protected readonly skeleton = computed(() => this.list()?.showSkeleton() ?? false);
  protected readonly empty = computed(() => this.list()?.empty() ?? !this.items().length);
  protected readonly page = computed(() => this.list()?.data()?.pagination);
  protected readonly initials = initialsOf;

  /** Every row's cells and buttons, worked out once per change of the rows or columns. */
  protected readonly view = computed(() => {
    const custom = new Map(this.cellTemplates().map((c) => [c.bbCell(), c.template]));
    const columns = this.columns();
    const actions = this.actions();
    const track = this.trackBy();
    return this.items().map((row) => ({
      row,
      id: track(row),
      cells: columns.map((c) => this.cell(c, row, custom)),
      actions: actions
        .filter((a) => (a.show?.(row) ?? true) && (a.run || !a.link || this.allowed(a.link(row))))
        .map((a) => this.action(a, row)),
    }));
  });

  /** The rows' order, for previous / next on the details page a row opens (`bb-detail-nav`). */
  private readonly detailOrder = inject(DetailOrder);
  private readonly auth = inject(AuthService);

  /** A link to a page this admin can't open shows as plain text (no dead ends). */
  private allowed(link: TableLink | null | undefined): TableLink | undefined {
    if (!link) return undefined;
    const needs = pagePermission(link);
    return !needs || this.auth.can(needs) ? link : undefined;
  }
  private readonly remembered = effect(() => {
    const ids = this.view()
      .map((r) => r.id)
      .filter((id): id is string => typeof id === 'string');
    untracked(() => this.detailOrder.remember(ids));
  });

  /** The Actions column shows only when some row on this page has a button (e.g. a refund). */
  protected readonly hasActions = computed(() => this.view().some((r) => r.actions.length));

  private cell(
    c: TableColumn<T>,
    row: T,
    custom: Map<string, TemplateRef<{ $implicit: unknown }>>,
  ): CellView {
    const template = c.key ? custom.get(c.key) : undefined;
    if (template) return { custom: template, blank: false, badges: [], lines: [] };
    const paise = c.paise?.(row);
    const value = present(paise) ? formatPaise(paise) || '₹0' : c.value?.(row);
    const date = c.date?.(row) || undefined;
    const badges = list(c.badge?.(row)).map((b) => ({
      label: b.label,
      class: badgeClass(b),
      title: b.title ?? '',
    }));
    const lines = list(c.sub?.(row));
    const tag = c.tag?.(row) || undefined;
    const avatar = c.avatar?.(row);
    return {
      blank: !present(value) && !date && !badges.length && !avatar && !lines.length && !tag,
      avatar,
      value: present(value) ? value : undefined,
      date,
      link: present(value) ? this.allowed(c.link?.(row)) : undefined,
      run: c.run && (() => c.run!(row)),
      badges,
      lines,
      tag,
    };
  }

  private action(a: TableAction<T>, row: T): ActionView {
    return {
      icon: a.icon,
      label: typeof a.label === 'function' ? a.label(row) : a.label,
      text: !!a.text,
      danger: a.danger?.(row) ?? false,
      disabled: a.disabled?.(row) ?? false,
      link: this.allowed(a.link?.(row)),
      run: a.run && (() => a.run!(row)),
      menu: a.menu?.(row),
    };
  }

  /** A click (or Enter) on the row itself or plain text in it, not on a control inside it. */
  protected open(event: Event, row: T): void {
    const target = event.target as Element;
    const control = target.closest(
      'a, button, input, select, textarea, [role="switch"], np-toggle',
    );
    if (this.clickable() && (!control || control === event.currentTarget)) this.rowClick.emit(row);
  }

  protected toggleMenu(menu: MenuComponent, event: Event): void {
    toggleEndAligned(menu, event, COMPACT_MENU_WIDTH);
  }
}
