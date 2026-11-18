import { NgTemplateOutlet } from '@angular/common';
import { NpIconPipe } from '../../shared/icons/np-icon-name';
import { IconComponent } from 'nexprime';
import {
  ChangeDetectionStrategy,
  Component,
  Signal,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  IsActiveMatchOptions,
  NavigationEnd,
  Params,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { filter } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { currentUrl } from '../../core/services/current-url';
import { NotificationBell } from '../../shared/components/notification-bell/notification-bell';
import { BrandLogo } from '../../shared/components/brand-logo/brand-logo';
import { InstallPromptService } from '../../core/services/install-prompt.service';
import { ThemeService } from '../../core/services/theme.service';
import { DESKTOP_UP, mediaQuery } from '../../core/services/media-query';

export interface NavItem {
  label: string;
  icon: string;
  /** Page link; a group (with `children`) has none of its own. */
  link?: string;
  /** Query params of the link, e.g. `{ role: 'customer' }`; the link is active only with them. */
  query?: Params;
  exact?: boolean;
  badge?: Signal<number>;
  /** Makes the item an expandable group of sub-links. */
  children?: NavItem[];
}

import { initialsOf } from '../../shared/models/user.models';

const SIDEBAR_KEY = 'bb-sidebar-hidden';

@Component({
  selector: 'bb-panel-shell',
  imports: [
    NgTemplateOutlet,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    MatDividerModule,
    IconComponent,
    NpIconPipe,
    MatListModule,
    MatMenuModule,
    MatSidenavModule,
    MatToolbarModule,
    MatTooltipModule,
    BrandLogo,
    NotificationBell,
  ],
  templateUrl: './panel-shell.html',
  styleUrl: './panel-shell.scss',
  host: { '(document:click)': 'closeRailMenuOnOutsideClick($event)' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PanelShell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly panelLabel = input.required<string>();
  readonly navItems = input.required<NavItem[]>();
  readonly profileLink = input.required<string>();

  private readonly sidenav = viewChild.required(MatSidenav);

  protected readonly user = this.auth.user;
  protected readonly installer = inject(InstallPromptService);
  protected readonly themes = inject(ThemeService);
  protected readonly initials = computed(() => initialsOf(this.user()?.name) || '?');
  protected readonly photo = computed(() => this.user()?.avatarUrl || null);

  private readonly url = currentUrl();

  /** A link with query params (e.g. Users by role) is active on its page with those params. */
  protected readonly withQuery: IsActiveMatchOptions = {
    paths: 'exact',
    queryParams: 'subset',
    matrixParams: 'ignored',
    fragment: 'ignored',
  };

  /** Groups whose page is open; they start expanded (a manual toggle wins until the next navigation). */
  protected readonly openGroups = linkedSignal(
    () => new Set(this.navItems().filter((g) => this.groupActive(g)).map((g) => g.label)),
  );

  /** A closed group shows the total of its links' badges, so nothing waiting is hidden. */
  protected groupBadge(group: NavItem): number {
    return (group.children ?? []).reduce((sum, child) => sum + (child.badge?.() ?? 0), 0);
  }

  protected toggleGroup(label: string): void {
    this.openGroups.update((open) => {
      const next = new Set(open);
      if (!next.delete(label)) next.add(label);
      return next;
    });
  }

  protected readonly isDesktop = mediaQuery(DESKTOP_UP, true);

  /** Desktop: the sidebar narrowed to an icon rail for more room (remembered on this device). */
  private readonly collapsed = signal(false);
  protected readonly rail = computed(() => this.isDesktop() && this.collapsed());

  protected toggleSidebar(): void {
    this.collapsed.update((c) => !c);
    localStorage.setItem(SIDEBAR_KEY, this.collapsed() ? '1' : '0');
  }

  // Rail group menus have no backdrop (it would swallow the click on the next icon): one menu at
  // a time, and a click outside the menus and their icons closes it.
  private openRailMenu: MatMenuTrigger | null = null;

  // (Closing a menu that is already closed does nothing, so the last one opened is enough.)
  protected railMenuOpened(trigger: MatMenuTrigger): void {
    if (this.openRailMenu !== trigger) this.openRailMenu?.closeMenu();
    this.openRailMenu = trigger;
  }

  protected closeRailMenuOnOutsideClick(event: MouseEvent): void {
    if (!(event.target as Element | null)?.closest('.bb-rail-menu, .rail-trigger')) {
      this.openRailMenu?.closeMenu();
    }
  }

  /** Rail: a group icon is highlighted while one of its pages is open. */
  protected groupActive(group: NavItem): boolean {
    const path = this.url().split(/[?#]/)[0];
    return !!group.children?.some((c) => c.link && path.startsWith(c.link));
  }

  constructor() {
    afterNextRender(() => this.collapsed.set(localStorage.getItem(SIDEBAR_KEY) === '1'));
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        if (!this.isDesktop()) void this.sidenav().close();
      });
  }

  protected logout(): void {
    this.auth.logout().subscribe();
  }
}
