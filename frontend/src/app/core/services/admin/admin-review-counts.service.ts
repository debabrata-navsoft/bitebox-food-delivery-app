import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { Observable, catchError, filter, forkJoin, map, merge, of, switchMap } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { inBackground } from '../page-loader';
import { pollWhileVisible } from '../poll';
import { AdminOrdersService } from '../order-management.service';
import { AdminCatalogService } from './admin-catalog.service';
import { RestaurantStatus } from '../../models/catalog.models';

const POLL_MS = 60_000;

/** Null when this admin can't review the list, or the count could not be loaded. */
const whenAllowed = <T>(allowed: boolean, request: () => Observable<T>): Observable<T | null> =>
  allowed ? request().pipe(catchError(() => of(null))) : of(null);

/**
 * What is waiting for an admin's decision: restaurant applications and delivery partners'
 * documents in review. Shared by the sidebar badges and the dashboards' review shortcuts. The admin
 * layout calls `watch()`; counts refresh every minute while the tab is visible and after each
 * navigation (so they drop as soon as something is approved).
 */
@Injectable({ providedIn: 'root' })
export class AdminReviewCounts {
  private readonly auth = inject(AuthService);
  private readonly catalog = inject(AdminCatalogService);
  private readonly orders = inject(AdminOrdersService);
  private readonly router = inject(Router);

  /** Every restaurant status's count (null: not allowed or not loaded). */
  readonly restaurants = signal<Record<RestaurantStatus, number> | null>(null);
  readonly pendingRestaurants = computed(() => this.restaurants()?.pending ?? 0);
  /** Delivery partners whose documents are in review. */
  readonly pendingRiders = signal(0);

  private load(): Observable<void> {
    return forkJoin([
      whenAllowed(this.auth.can('restaurants:manage'), () => this.catalog.restaurantCounts()),
      whenAllowed(this.auth.can('riders:manage'), () =>
        this.orders.riders({ verification: 'pending', limit: 1 }),
      ),
    ]).pipe(
      map(([restaurants, riders]) => {
        this.restaurants.set(restaurants);
        this.pendingRiders.set(riders?.pagination.total ?? 0);
      }),
    );
  }

  /** Keeps the counts fresh while the caller (the admin layout) lives. */
  watch(destroyRef: DestroyRef = inject(DestroyRef)): this {
    const navigated = this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      switchMap(() => inBackground(this.load())),
    );
    merge(pollWhileVisible(() => this.load(), POLL_MS), navigated)
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe();
    return this;
  }
}
