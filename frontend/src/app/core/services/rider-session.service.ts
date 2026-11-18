import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, catchError, of } from 'rxjs';
import { RiderDashboard } from '../../shared/models/order-management.models';
import { errorMessage } from './api-error';
import { NotificationService } from './notification.service';
import { RiderService } from './order-management.service';
import { liveRefresh } from './poll';
import { RiderGps } from './rider-gps.service';

const POLL_MS = 30_000;

/**
 * The rider's dashboard state for the whole delivery panel (provided by `DeliveryLayout`), so
 * every rider page reads one copy: one live refresh, and GPS shared for as long as the rider is
 * online in the panel instead of restarting on each page change.
 */
@Injectable()
export class RiderSession {
  private readonly rider = inject(RiderService);
  private readonly notify = inject(NotificationService);
  private readonly gps = inject(RiderGps);

  readonly data = signal<RiderDashboard | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly acting = signal(false);
  readonly profile = computed(() => this.data()?.profile ?? null);
  readonly online = computed(() => this.profile()?.isOnline ?? false);
  readonly offer = computed(() => this.data()?.offer ?? null);
  readonly active = computed(() => this.data()?.activeOrder ?? null);

  /** The "location detected" popup and the place name, once per online session. */
  locationShown = false;
  readonly detectedPlace = signal<string | null>(null);

  constructor() {
    const reload = () =>
      this.rider.dashboard().pipe(
        catchError((err: unknown) => {
          this.loadError.set(errorMessage(err, 'Could not load your deliveries.'));
          return of(null);
        }),
      );
    liveRefresh(reload, { pollMs: POLL_MS, debounceMs: 200 })
      .pipe(takeUntilDestroyed())
      .subscribe((d) => d && this.apply(d));

    effect(() => {
      const online = this.online();
      const delivering = !!this.active();
      untracked(() => this.gps.update(online, delivering));
    });
    inject(DestroyRef).onDestroy(() => this.gps.stop());
  }

  apply(d: RiderDashboard): void {
    this.loadError.set(null);
    this.data.set(d);
  }

  /** Re-reads the dashboard (after a failed action); errors keep the last state. */
  refresh(): void {
    this.rider.dashboard().subscribe({ next: (d) => this.apply(d), error: () => undefined });
  }

  /** Sends a rider action, applies the fresh dashboard and confirms it; errors re-read it. */
  run(request: Observable<RiderDashboard>, message: string, done?: () => void): void {
    this.acting.set(true);
    request.subscribe({
      next: (d) => {
        this.acting.set(false);
        this.apply(d);
        this.notify.success(message);
        done?.();
      },
      error: (err: unknown) => {
        this.acting.set(false);
        this.notify.error(errorMessage(err));
        this.refresh();
      },
    });
  }
}
