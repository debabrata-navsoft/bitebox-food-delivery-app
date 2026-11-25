import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, PLATFORM_ID, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterOutlet,
} from '@angular/router';
import { EMPTY, filter, map, of, switchMap, timer } from 'rxjs';
import { PageLoader } from './core/services/page-loader';
import { InstallPromptService } from './core/services/install-prompt.service';
import { PushNotificationService } from './core/services/push-notification.service';
import { ThemeService } from './core/services/theme.service';
import { keepMaterialDialogsOpenOnOutsideClick } from './shared/dialog/outside-click';
import { AppStatus } from './shared/components/app-status/app-status';
import { BrandLoader } from './shared/components/brand-loader/brand-loader';

/** The installed BiteBox app on a phone or tablet (the same rule as the splash in index.html). */
const PHONE_APP =
  '(display-mode: standalone) and (pointer: coarse), (display-mode: fullscreen) and (pointer: coarse)';

@Component({
  imports: [RouterOutlet, AppStatus, BrandLoader],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly loading = inject(PageLoader).visible;
  /** The installed app on a phone: its own loaders (the website keeps the thin top bar). */
  private readonly phoneApp =
    isPlatformBrowser(inject(PLATFORM_ID)) &&
    typeof matchMedia === 'function' &&
    matchMedia(PHONE_APP).matches;
  /** In the phone app, a page change still running after 300 ms (its code downloading on a slow
   * connection) shows the BiteBox loader until the page opens. Quick changes never show it. */
  protected readonly changingPage = toSignal(
    this.phoneApp
      ? inject(Router).events.pipe(
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
        )
      : EMPTY,
    { initialValue: false },
  );

  constructor() {
    // Started with the app (not with a lazy page): the install prompt can fire at any time,
    // and signing out must always unsubscribe this browser from push.
    inject(InstallPromptService);
    inject(PushNotificationService);
    // Keeps <html data-theme> in step with the stored choice and the device setting.
    inject(ThemeService);
    // Dialogs close only through their own buttons (or Escape), never a click outside.
    keepMaterialDialogsOpenOnOutsideClick();
  }
}
