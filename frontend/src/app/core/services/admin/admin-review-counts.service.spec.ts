import { DestroyRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { AdminOrdersService } from '../order-management.service';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminReviewCounts } from './admin-review-counts.service';
import { refreshesReviews } from './review-changes';

describe('AdminReviewCounts', () => {
  it('reloads the badges as soon as an approval goes through, without waiting for the poll', async () => {
    let pending = 1;
    const restaurantCounts = vi.fn(() => of({ pending, approved: 3, rejected: 0, suspended: 0 }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { can: () => true } },
        { provide: AdminCatalogService, useValue: { restaurantCounts } },
        {
          provide: AdminOrdersService,
          useValue: { riders: () => of({ items: [], pagination: { total: 0 } }) },
        },
      ],
    });
    const counts = TestBed.inject(AdminReviewCounts);
    TestBed.runInInjectionContext(() => counts.watch(TestBed.inject(DestroyRef)));
    await Promise.resolve();
    expect(counts.pendingRestaurants()).toBe(1);

    // An admin approves the restaurant: the status request succeeds and signals the change.
    pending = 0;
    of({ status: 'approved' }).pipe(refreshesReviews()).subscribe();
    await Promise.resolve();

    expect(counts.pendingRestaurants()).toBe(0);
    expect(restaurantCounts).toHaveBeenCalledTimes(2);
  });
});
