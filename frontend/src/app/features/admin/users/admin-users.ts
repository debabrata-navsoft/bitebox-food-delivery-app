import { BreakpointObserver } from '@angular/cdk/layout';
import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';
import { AdminUsersService } from '../../../core/services/admin/admin-users.service';
import { errorMessage } from '../../../core/services/api-error';
import { PageHeader } from '../../../shared/components/page-header/page-header';
import { Pagination } from '../../../shared/models/api.models';
import { ROLE_META, Role, User } from '../../../shared/models/user.models';

@Component({
  selector: 'bb-admin-users',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatSelectModule,
    MatTableModule,
    PageHeader,
  ],
  templateUrl: './admin-users.html',
  styleUrl: './admin-users.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminUsers implements OnInit {
  private readonly service = inject(AdminUsersService);

  /** Optional ?role= filter from the URL (e.g. links from the dashboard). */
  readonly role = input<Role>();

  protected readonly roleMeta = ROLE_META;
  protected readonly roleLabel = (role: Role) => ROLE_META[role].label;
  protected readonly roles = Object.keys(ROLE_META) as Role[];
  protected readonly columns = ['name', 'phone', 'role', 'status', 'createdAt'];

  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly roleFilter = new FormControl<Role | ''>('', { nonNullable: true });

  protected readonly users = signal<User[]>([]);
  protected readonly pagination = signal<Pagination>({ page: 1, limit: 10, total: 0, totalPages: 0 });
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly isDesktop = toSignal(
    inject(BreakpointObserver)
      .observe('(min-width: 768px)')
      .pipe(map((s) => s.matches)),
    { initialValue: true },
  );

  constructor() {
    this.search.valueChanges
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.load(1));
    this.roleFilter.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.load(1));
  }

  ngOnInit(): void {
    const role = this.role();
    if (role && this.roles.includes(role)) this.roleFilter.setValue(role, { emitEvent: false });
    this.load(1);
  }

  protected onPage(event: PageEvent): void {
    this.pagination.update((p) => ({ ...p, limit: event.pageSize }));
    this.load(event.pageIndex + 1);
  }

  protected load(page: number): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .list({
        page,
        limit: this.pagination().limit,
        search: this.search.value.trim() || undefined,
        role: this.roleFilter.value || undefined,
      })
      .subscribe({
        next: (res) => {
          this.users.set(res.items);
          this.pagination.set(res.pagination);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(errorMessage(err, 'Could not load users.'));
          this.loading.set(false);
        },
      });
  }
}
