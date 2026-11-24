import { inject } from '@angular/core';
import { EMPTY, catchError, switchMap, tap } from 'rxjs';
import { NotificationService } from '../../../core/services/notification.service';
import { AdminOrdersService } from '../../../core/services/order-management.service';
import { confirmed } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { BbDialog } from '../../../shared/dialog/bb-dialog';
import { errorMessage } from '../../../shared/utils/api-error';

/** The Suspend / Reactivate button's label for a rider's account status. */
export const riderStatusAction = (status: string) => (status === 'active' ? 'Suspend' : 'Reactivate');

/**
 * `change(rider)`: asks, then suspends an active rider (taken offline and signed out; the API needs
 * a reason, which the rider sees) or reactivates a suspended one, and says how it went. Emits once
 * saved; nothing if cancelled or it failed. Call in an injection context (the Delivery partners
 * list and a rider's page).
 */
export function riderStatusChanger() {
  const dialog = inject(BbDialog);
  const api = inject(AdminOrdersService);
  const notify = inject(NotificationService);
  return (rider: { id: string; name: string; status: string }) => {
    const suspend = rider.status === 'active';
    return confirmed(
      dialog,
      suspend
        ? {
            title: `Suspend ${rider.name}?`,
            message: 'They are taken offline and signed out, and cannot accept deliveries.',
            confirmLabel: 'Suspend',
            danger: true,
            reasonLabel: 'Reason (shown to the rider)',
          }
        : {
            title: `Reactivate ${rider.name}?`,
            message: 'They can sign in and go online again.',
            confirmLabel: 'Reactivate',
          },
      '420px',
    ).pipe(
      switchMap((result) =>
        api.setRiderStatus(
          rider.id,
          suspend ? 'suspended' : 'active',
          typeof result === 'string' ? result : undefined,
        ),
      ),
      tap(() => notify.success(suspend ? 'Rider suspended' : 'Rider reactivated')),
      catchError((err: unknown) => {
        notify.error(errorMessage(err));
        return EMPTY;
      }),
    );
  };
}
