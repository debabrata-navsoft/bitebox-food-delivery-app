import { MonoTypeOperatorFunction, Subject, tap } from 'rxjs';

/**
 * Fires when an admin changes something the sidebar's review badges count (a restaurant's approval,
 * a rider's verification). AdminReviewCounts listens and reloads the badges at once. A plain module
 * Subject, so the services that change these don't depend on the counts service (which uses them).
 */
export const reviewChanges = new Subject<void>();

/** After the request succeeds, tells the review badges to reload. */
export const refreshesReviews = <T>(): MonoTypeOperatorFunction<T> =>
  tap(() => reviewChanges.next());
