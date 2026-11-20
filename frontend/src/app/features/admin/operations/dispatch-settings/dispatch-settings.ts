import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, linkedSignal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormRoot, TreeValidationResult, form } from '@angular/forms/signals';
import { IconComponent } from 'nexprime';
import { firstValueFrom } from 'rxjs';
import { DistanceSettings } from '../../../../core/models/admin-roles.models';
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

/** The two distances, each with its default, card text and validation label. */
const RULES = [
  {
    key: 'maxPickupDistanceKm',
    defaultKey: 'defaultMaxPickupDistanceKm',
    label: 'Pickup distance',
    title: 'Delivery partner pickup distance',
    icon: 'bike',
    note:
      'Only online delivery partners within this distance of the restaurant are offered a new ' +
      'order, nearest first. Larger finds a partner sooner; smaller keeps pickups quick.',
  },
  {
    key: 'maxDeliveryDistanceKm',
    defaultKey: 'defaultMaxDeliveryDistanceKm',
    label: 'Delivery range',
    title: 'Customer delivery range',
    icon: 'house',
    note:
      'Customers see only restaurants within this distance of their location, and can order only ' +
      'to addresses within it. Larger shows more restaurants; smaller keeps deliveries short.',
  },
] as const;

type Distances = Record<keyof DistanceSettings, number | null>;

/**
 * The two distance rules admins set: how far a rider may be from the restaurant to be offered its
 * orders, and how far a customer may be from a restaurant to see it and order from it.
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

  protected readonly rules = RULES;
  /** The form starts from the saved distances. */
  protected readonly model = linkedSignal<Distances>(() => ({
    maxPickupDistanceKm: this.data()?.maxPickupDistanceKm ?? null,
    maxDeliveryDistanceKm: this.data()?.maxDeliveryDistanceKm ?? null,
  }));
  protected readonly form = form(
    this.model,
    (path) => RULES.forEach((r) => numberRange(path[r.key], r.label, 1, 50)),
    { submission: { action: () => this.save() } },
  );

  private async save(): Promise<TreeValidationResult> {
    const { maxPickupDistanceKm, maxDeliveryDistanceKm } = this.model();
    try {
      const saved = await firstValueFrom(
        this.api.saveDispatchSettings({
          maxPickupDistanceKm: Number(maxPickupDistanceKm),
          maxDeliveryDistanceKm: Number(maxDeliveryDistanceKm),
        }),
      );
      this.settings.set(saved);
      this.notify.success('Distance settings saved');
      return undefined;
    } catch (err) {
      const fields = fieldErrors(err);
      if (!fields.length) this.notify.error(errorMessage(err));
      return serverErrors(this.form, fields);
    }
  }
}
