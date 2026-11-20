import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormRoot, TreeValidationResult, form, pattern, validate } from '@angular/forms/signals';
import { ToggleComponent } from 'nexprime';
import { firstValueFrom } from 'rxjs';
import { errorMessage, fieldErrors } from '../../../../core/services/api-error';
import { MyRestaurantService } from '../../../../core/services/my-restaurant.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { fromIsoDay, isoDay } from '../../../../shared/forms/dates';
import { serverErrors, shownError } from '../../../../shared/forms/form-errors';
import { NP_FORM_FIELDS } from '../../../../shared/forms/np-form-fields';
import { Restaurant } from '../../../../shared/models/catalog.models';

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const legalOf = (r: Restaurant) => ({
  ownerName: r.ownerName ?? '',
  gstRegistered: r.gstRegistered ?? false,
  gstin: r.gstin ?? '',
  fssaiNumber: r.fssaiNumber ?? '',
  fssaiValidUntil: fromIsoDay(r.fssaiValidUntil),
});

/**
 * A restaurant's legal and tax details (owner/business name, FSSAI, GST). Saves through
 * MyRestaurantService: the partner's own restaurant, or the admin's (Restaurant accounts provides
 * an admin version of the service).
 */
@Component({
  selector: 'bb-restaurant-legal-form',
  imports: [FormRoot, NP_FORM_FIELDS, ToggleComponent],
  templateUrl: './restaurant-legal-form.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestaurantLegalForm {
  private readonly restaurants = inject(MyRestaurantService);
  private readonly notify = inject(NotificationService);
  readonly restaurant = input.required<Restaurant>();
  readonly saved = output<Restaurant>();
  protected readonly shownError = shownError;

  protected readonly model = signal(legalOf({} as Restaurant));
  protected readonly form = form(
    this.model,
    (p) => {
      pattern(p.fssaiNumber, /^(\d{14})?$/, { message: 'An FSSAI number has 14 digits' });
      validate(p.gstin, ({ value, valueOf }) => {
        const gstin = value().trim().toUpperCase();
        if (valueOf(p.gstRegistered) && !gstin) return { kind: 'required', message: 'Enter the GSTIN' };
        return gstin && !GSTIN.test(gstin) ? { kind: 'gstin', message: 'Enter a valid 15-character GSTIN' } : undefined;
      });
    },
    { submission: { action: () => this.save() } },
  );

  constructor() {
    effect(() => {
      const r = this.restaurant();
      if (!untracked(() => this.form().dirty())) untracked(() => this.form().reset(legalOf(r)));
    });
  }

  protected setGst(on: boolean): void {
    this.model.update((m) => ({ ...m, gstRegistered: on }));
    this.form.gstRegistered().markAsDirty();
  }

  private async save(): Promise<TreeValidationResult> {
    const m = this.model();
    try {
      const restaurant = await firstValueFrom(
        this.restaurants.update({
          ownerName: m.ownerName.trim(),
          gstRegistered: m.gstRegistered,
          gstin: m.gstin.trim().toUpperCase(),
          fssaiNumber: m.fssaiNumber.trim(),
          fssaiValidUntil: m.fssaiValidUntil ? isoDay(m.fssaiValidUntil) : null,
        }),
      );
      this.form().reset(legalOf(restaurant));
      this.notify.success('Details saved');
      this.saved.emit(restaurant);
      return undefined;
    } catch (err) {
      const fields = fieldErrors(err);
      if (!fields.length) this.notify.error(errorMessage(err));
      return serverErrors(this.form, fields);
    }
  }
}
