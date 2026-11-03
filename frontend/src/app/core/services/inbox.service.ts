import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, PLATFORM_ID, effect, inject, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { ApiResponse } from '../../shared/models/api.models';
import { AppNotification, NotificationPage } from '../../shared/models/payment.models';
import { RealtimeService } from './realtime.service';

const PAGE_SIZE = 20;

/**
 * The signed-in user's in-app notifications (the bell). Loaded once per
 * sign-in, then kept current from `notification:new` pushes.
 * (Not to be confused with NotificationService, which shows snackbars.)
 */
@Injectable({ providedIn: 'root' })
export class InboxService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/notifications`;

  readonly items = signal<AppNotification[]>([]);
  readonly unread = signal(0);
  readonly loaded = signal(false);

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const auth = inject(AuthService);
    effect(() => {
      const userId = auth.user()?.id;
      untracked(() => (userId ? this.load() : this.clear()));
    });
    inject(RealtimeService)
      .notifications$.pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((n) => {
        if (this.items().some((i) => i.id === n.id)) return;
        this.items.update((list) => [n, ...list].slice(0, PAGE_SIZE));
        if (!n.readAt) this.unread.update((u) => u + 1);
      });
  }

  load(): void {
    this.http
      .get<ApiResponse<NotificationPage>>(this.url, { params: { limit: PAGE_SIZE } })
      .pipe(map((r) => r.data))
      .subscribe({
        next: ({ items, unread }) => {
          this.items.set(items);
          this.unread.set(unread);
          this.loaded.set(true);
        },
        error: () => this.loaded.set(true),
      });
  }

  /** Optimistic: the badge updates at once; a failure just reloads the truth. */
  markRead(n: AppNotification): void {
    if (n.readAt) return;
    const readAt = new Date().toISOString();
    this.items.update((list) => list.map((i) => (i.id === n.id ? { ...i, readAt } : i)));
    this.unread.update((u) => Math.max(0, u - 1));
    this.http.patch(`${this.url}/${n.id}/read`, {}).subscribe({ error: () => this.load() });
  }

  markAllRead(): void {
    if (!this.unread()) return;
    const readAt = new Date().toISOString();
    this.items.update((list) => list.map((i) => (i.readAt ? i : { ...i, readAt })));
    this.unread.set(0);
    this.http.post(`${this.url}/read-all`, {}).subscribe({ error: () => this.load() });
  }

  private clear(): void {
    this.items.set([]);
    this.unread.set(0);
    this.loaded.set(false);
  }
}
