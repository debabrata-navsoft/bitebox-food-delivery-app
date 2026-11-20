import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, linkedSignal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormRoot, TreeValidationResult, form } from '@angular/forms/signals';
import { IconComponent } from 'nexprime';
import { firstValueFrom } from 'rxjs';
import { OperationsService } from '../../../../core/services/admin/operations.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { serverErrors } from '../../../../shared/forms/form-errors';
import { NP_FORM_FIELDS } from '../../../../shared/forms/np-form-fields';
import {
  errorMessage,
  fieldErrors,
  resourceError,
  resourceValue,
} from '../../../../shared/utils/api-error';
import { numberRange } from '../../../../shared/validators/form-rules';

/**
 * How far a rider may be from the restaurant to be offered its orders (dispatch radius). Riders
 * outside it are never offered the order; the nearest free rider inside it is offered first.
 */
@Component({
  selector: 'bb-dispatch-settings',
  imports: [DatePipe, FormRoot, NP_FORM_FIELDS, IconComponent, PageHeader],
  templateUrl: './dispatch-settings.html',
  styleUrl: './dispatch-settings.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DispatchSettingsPage {
  private readonly api = inject(OperationsService);
  private readonly notify = inject(NotificationService);

  protected readonly settings = rxResource({ stream: () => this.api.dispatchSettings() });
  protected readonly data = resourceValue(this.settings);
  protected readonly loadError = resourceError(
    this.settings,
    'Could not load the dispatch settings.',
  );

  /** The form starts from the saved radius. */
  protected readonly model = linkedSignal(() => ({
    maxPickupDistanceKm: (this.data()?.maxPickupDistanceKm ?? null) as number | null,
  }));
  protected readonly form = form(this.model, (path) => numberRange(path.maxPickupDistanceKm, 'Distance', 1, 50), {
    submission: { action: () => this.save() },
  });

  private async save(): Promise<TreeValidationResult> {
    try {
      const saved = await firstValueFrom(this.api.saveDispatchSettings(Number(this.model().maxPickupDistanceKm)));
      this.settings.set(saved);
      this.notify.success(`Riders within ${saved.maxPickupDistanceKm} km now get new orders`);
      return undefined;
    } catch (err) {
      const fields = fieldErrors(err);
      if (!fields.length) this.notify.error(errorMessage(err));
      return serverErrors(this.form, fields);
    }
  }
}
