import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormRoot, TreeValidationResult, form, required } from '@angular/forms/signals';
import { ButtonComponent, SelectOption } from 'nexprime';
import { firstValueFrom } from 'rxjs';
import { errorMessage, fieldErrors } from '../../../core/services/api-error';
import { NotificationService } from '../../../core/services/notification.service';
import { RiderService } from '../../../core/services/order-management.service';
import {
  BB_DIALOG_DATA,
  BbDialog,
  BbDialogRef,
  BbDialogTitle,
} from '../../../shared/dialog/bb-dialog';
import { serverErrors, shownError } from '../../../shared/forms/form-errors';
import { NP_FORM_FIELDS } from '../../../shared/forms/np-form-fields';
import { VEHICLE_LABEL, VehicleType } from '../../../shared/models/checkout.models';
import { RiderProfile } from '../../../shared/models/order-management.models';

const VEHICLE_OPTIONS: SelectOption[] = (Object.keys(VEHICLE_LABEL) as VehicleType[]).map((v) => ({
  value: v,
  label: VEHICLE_LABEL[v],
}));

/** The rider's vehicle (needed before going online). Closes with the saved profile. */
@Component({
  selector: 'bb-vehicle-dialog',
  imports: [FormRoot, NP_FORM_FIELDS, BbDialogTitle, ButtonComponent],
  templateUrl: './vehicle-dialog.html',
  styleUrl: './vehicle-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VehicleDialog {
  private readonly current = inject<RiderProfile | null>(BB_DIALOG_DATA);
  protected readonly ref = inject<BbDialogRef<RiderProfile>>(BbDialogRef);
  private readonly rider = inject(RiderService);
  private readonly notify = inject(NotificationService);

  protected readonly options = VEHICLE_OPTIONS;
  protected readonly isNew = !this.current?.vehicleType;
  protected readonly shownError = shownError;
  protected readonly model = signal({
    vehicleType: this.current?.vehicleType ?? '',
    vehicleNumber: this.current?.vehicleNumber ?? '',
  });
  protected readonly form = form(
    this.model,
    (path) => required(path.vehicleType, { message: 'Choose your vehicle' }),
    { submission: { action: () => this.save() } },
  );

  private async save(): Promise<TreeValidationResult> {
    const { vehicleType, vehicleNumber } = this.model();
    try {
      const profile = await firstValueFrom(
        this.rider.saveVehicle(vehicleType as VehicleType, vehicleNumber.trim()),
      );
      this.notify.success('Vehicle saved');
      this.ref.close(profile);
      return undefined;
    } catch (err) {
      // Field errors (422) show under their fields; anything else as a message.
      const details = fieldErrors(err);
      if (!details.length) this.notify.error(errorMessage(err));
      return serverErrors(this.form, details);
    }
  }
}

/** Opens the vehicle dialog; emits the saved profile (nothing when cancelled). */
export const openVehicleDialog = (dialog: BbDialog, current: RiderProfile | null) =>
  dialog.result<VehicleDialog, RiderProfile | null, RiderProfile>(VehicleDialog, {
    data: current,
    width: '480px',
  });
