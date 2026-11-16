import { Resource, inject, signal } from '@angular/core';
import { SelectOption } from 'nexprime';
import { Observable } from 'rxjs';
import { errorMessage } from '../../core/services/api-error';
import { NotificationService } from '../../core/services/notification.service';
import { COUPON_STATUS_LABEL } from '../models/checkout.models';

/** Helpers shared by the admin coupon list, the review queue and the restaurant's offers. */
export const STATUS_OPTIONS: SelectOption[] = [
  { value: '', label: 'Any status' },
  ...Object.entries(COUPON_STATUS_LABEL).map(([value, label]) => ({ value, label })),
];

/** A resource's value, or undefined while loading or after an error (`value()` throws then). */
export const loaded = <T>(resource: Resource<T>): T | undefined =>
  resource.hasValue() ? resource.value() : undefined;

/**
 * Runs one row's action: marks the row busy, then toasts the result and refreshes, or toasts
 * the error. Call in an injection context.
 */
export function rowActions(refresh: () => void) {
  const notify = inject(NotificationService);
  const busy = signal<string | null>(null);
  const run = (id: string, request: Observable<unknown>, done: string): void => {
    busy.set(id);
    request.subscribe({
      next: () => {
        busy.set(null);
        notify.success(done);
        refresh();
      },
      error: (err: unknown) => {
        busy.set(null);
        notify.error(errorMessage(err));
      },
    });
  };
  return { busy: busy.asReadonly(), run };
}
