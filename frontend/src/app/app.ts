import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterOutlet,
} from '@angular/router';
import { filter, map, of, switchMap, timer } from 'rxjs';
import { PageLoader } from './core/services/page-loader';
import { InstallPromptService } from './core/services/install-prompt.service';
import { PushNotificationService } from './core/services/push-notification.service';
import { ThemeService } from './core/services/theme.service';
import { AppStatus } from './shared/components/app-status/app-status';
import { BrandLoader } from './shared/components/brand-loader/brand-loader';

@Component({
  imports: [RouterOutlet, AppStatus, BrandLoader],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly loading = inject(PageLoader).visible;
  /** A page change still running after 300 ms (its code downloading on a slow connection):
   * the BiteBox loader covers the page until it opens. Quick changes never show it. */
  protected readonly changingPage = toSignal(
    inject(Router).events.pipe(
      filter(
        (e) =>
          e instanceof NavigationStart ||
          e instanceof NavigationEnd ||
          e instanceof NavigationCancel ||
          e instanceof NavigationError,
      ),
      // Shown 300 ms into a change, hidden the moment it ends.
      switchMap((e) =>
        e instanceof NavigationStart ? timer(300).pipe(map(() => true)) : of(false),
      ),
    ),
    { initialValue: false },
  );

  constructor() {
    // Started with the app (not with a lazy page): the install prompt can fire at any time,
    // and signing out must always unsubscribe this browser from push.
    inject(InstallPromptService);
    inject(PushNotificationService);
    // Keeps <html data-theme> in step with the stored choice and the device setting.
    inject(ThemeService);
  }
}
