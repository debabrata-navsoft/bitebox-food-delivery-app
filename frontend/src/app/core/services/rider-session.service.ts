import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { EMPTY, Observable, catchError, interval, of, switchMap } from 'rxjs';
import {
  OfferDecision,
  OfferDialog,
  offerProgress,
  openOfferDialog,
} from '../../shared/components/offer-dialog/offer-dialog';
import { BbDialog, BbDialogRef } from '../../shared/dialog/bb-dialog';
import { RiderDashboard, RiderOrder } from '../models/order-management.models';
import { errorMessage } from '../../shared/utils/api-error';
import { NotificationService } from './notification.service';
import { RiderService } from './order-management.service';
import { liveRefresh } from './poll';
import { RiderGps } from './rider-gps.service';

const POLL_MS = 30_000;

/**
 * How long this request has left, by this device's clock. The server's expiry is used unless this
 * device's clock makes it impossible (already past, or longer than the whole window, i.e. the phone
 * clock is wrong); then the full window is assumed, since the server only sends live requests.
 */
export function offerTimeLeftMs(order: RiderOrder, now = Date.now()): number {
  const windowMs = (order.offerWindowSeconds || 90) * 1000;
  const left = order.offerExpiresAt ? new Date(order.offerExpiresAt).getTime() - now : NaN;
  return left > 0 && left <= windowMs + 5_000 ? left : windowMs;
}

/**
 * The rider's dashboard state for the whole delivery panel (provided by `DeliveryLayout`), so
 * every rider page reads one copy: one live refresh, GPS shared for as long as the rider is online,
 * and a new delivery request announced and shown as a popup on whichever rider page is open (once
 * per request, with a countdown that keeps running across page changes).
 */
@Injectable()
export class RiderSession {
  private readonly rider = inject(RiderService);
  private readonly notify = inject(NotificationService);
  private readonly gps = inject(RiderGps);
  private readonly dialog = inject(BbDialog);
  private readonly router = inject(Router);
  private offerDialog: BbDialogRef<OfferDecision, OfferDialog> | null = null;

  readonly data = signal<RiderDashboard | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly acting = signal(false);
  readonly profile = computed(() => this.data()?.profile ?? null);
  readonly online = computed(() => this.profile()?.isOnline ?? false);
  readonly offer = computed(() => this.data()?.offer ?? null);
  readonly active = computed(() => this.data()?.activeOrder ?? null);

  /** The request on screen and when it runs out on this device (set once per request). */
  private readonly deadline = signal<{ id: string; at: number } | null>(null);
  private readonly now = signal(Date.now());
  readonly offerSecondsLeft = computed(() => {
    const d = this.deadline();
    return d && d.id === this.offer()?.id ? Math.max(0, Math.ceil((d.at - this.now()) / 1000)) : 0;
  });
  readonly offerProgress = computed(() => offerProgress(this.offerSecondsLeft(), this.offer()));

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
    // Order events refresh at once; the timed poll only asks the server while the rider is online
    // (or before the first load), so offline riders browsing their history cost nothing.
    const poll = () => (this.online() || !this.data() ? reload() : EMPTY);
    liveRefresh(poll, { pollMs: POLL_MS, debounceMs: 200 })
      .pipe(takeUntilDestroyed())
      .subscribe((d) => d && this.apply(d));

    effect(() => {
      const online = this.online();
      const delivering = !!this.active();
      untracked(() => this.gps.update(online, delivering));
    });

    // The countdown ticks while there is a request, whichever rider page is open.
    toObservable(computed(() => this.offer() !== null))
      .pipe(
        switchMap((offered) => (offered ? interval(1000) : EMPTY)),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.now.set(Date.now()));

    // A new request: announce it and show the popup, once; close the popup once it is gone.
    effect(() => {
      const offer = this.offer();
      untracked(() => {
        if (offer?.id === this.deadline()?.id) return;
        this.offerDialog?.close();
        if (!offer) {
          this.deadline.set(null);
          return;
        }
        this.now.set(Date.now());
        this.deadline.set({ id: offer.id, at: Date.now() + offerTimeLeftMs(offer) });
        this.notify.info(`New delivery request from ${offer.restaurantSnapshot.name}`);
        this.openOffer();
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.offerDialog?.close();
      this.gps.stop();
    });
  }

  /** The request as a popup (again, from the dashboard's "View request"); it ends with a decision. */
  openOffer(): void {
    const order = this.offer();
    if (this.offerDialog || !order || this.offerSecondsLeft() === 0) return;
    this.offerDialog = openOfferDialog(this.dialog, { order, secondsLeft: this.offerSecondsLeft });
    this.offerDialog.closed.subscribe((decision) => {
      this.offerDialog = null;
      if (decision === 'accept') this.accept(order);
      else if (decision === 'decline') this.decline(order);
    });
  }

  accept(order: RiderOrder): void {
    this.run(
      this.rider.accept(order.id),
      'Accepted. Head to the restaurant.',
      () => void this.router.navigateByUrl('/delivery/current'),
    );
  }

  decline(order: RiderOrder): void {
    this.run(this.rider.decline(order.id), 'Request declined');
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
