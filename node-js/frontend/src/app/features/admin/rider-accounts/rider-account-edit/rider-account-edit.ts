import { ChangeDetectionStrategy, Component, computed, effect, inject, input, linkedSignal, signal, untracked } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormRoot, TreeValidationResult, form, maxLength, pattern, validate } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from 'nexprime';
import { firstValueFrom } from 'rxjs';
import {
  AdminRiderAccountsService,
  RiderAccount,
  RiderAccountPatch,
} from '../../../../core/services/admin/admin-rider-accounts.service';
import { errorMessage, fieldErrors } from '../../../../core/services/api-error';
import { NotificationService } from '../../../../core/services/notification.service';
import { ImageUpload } from '../../../../shared/components/image-upload/image-upload';
import { PhoneInput } from '../../../../shared/components/phone-input/phone-input';
import { loaded } from '../../../../shared/coupons/coupon-list';
import { birthDateRange, fromIsoDay, isoDay } from '../../../../shared/forms/dates';
import { serverErrors, shownError } from '../../../../shared/forms/form-errors';
import { POSTAL_CODE_PATTERN, phoneRules, requiredText } from '../../../../shared/forms/form-rules';
import { NP_FORM_FIELDS } from '../../../../shared/forms/np-form-fields';
import { VEHICLE_LABEL, VehicleType } from '../../../../shared/models/checkout.models';
import { GENDER_LABEL, Gender } from '../../../../shared/models/user.models';

const modelOf = (a: RiderAccount | undefined) => ({
  name: a?.user.name ?? '',
  gender: (a?.user.gender ?? '') as Gender | '',
  birthDate: fromIsoDay(a?.user.birthDate),
  address: {
    line1: a?.rider.address?.line1 ?? '',
    line2: a?.rider.address?.line2 ?? '',
    area: a?.rider.address?.area ?? '',
    city: a?.rider.address?.city ?? '',
    state: a?.rider.address?.state ?? '',
    postalCode: a?.rider.address?.postalCode ?? '',
  },
  emergencyContact: {
    name: a?.rider.emergencyContact?.name ?? '',
    phone: a?.rider.emergencyContact?.phone ?? '',
    relation: a?.rider.emergencyContact?.relation ?? '',
  },
  vehicleType: (a?.rider.vehicleType ?? '') as VehicleType | '',
  vehicleNumber: a?.rider.vehicleNumber ?? '',
  zone: a?.rider.zone ?? '',
});
type Model = ReturnType<typeof modelOf>;

/** Only what changed, shaped as the API expects (blank optional parts become null). */
function changes(before: Model, after: Model, photoBefore: string, photo: string): RiderAccountPatch {
  const patch: RiderAccountPatch = {};
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (after.name.trim() !== before.name) patch.name = after.name.trim();
  if (after.gender !== before.gender) patch.gender = after.gender || null;
  const day = after.birthDate ? isoDay(after.birthDate) : null;
  if (day !== (before.birthDate ? isoDay(before.birthDate) : null)) patch.birthDate = day;
  if (photo !== photoBefore) patch.avatarUrl = photo || null;
  if (!same(after.address, before.address)) {
    const a = after.address;
    patch.address = {
      line1: a.line1.trim(),
      city: a.city.trim(),
      state: a.state.trim(),
      postalCode: a.postalCode.trim(),
      ...(a.line2.trim() ? { line2: a.line2.trim() } : {}),
      ...(a.area.trim() ? { area: a.area.trim() } : {}),
    };
  }
  if (!same(after.emergencyContact, before.emergencyContact)) {
    const e = after.emergencyContact;
    patch.emergencyContact = e.name.trim() || e.phone
      ? { name: e.name.trim(), phone: e.phone, relation: e.relation.trim() || null }
      : null;
  }
  if (after.vehicleType && after.vehicleType !== before.vehicleType) patch.vehicleType = after.vehicleType;
  if (after.vehicleNumber.trim().toUpperCase() !== before.vehicleNumber.toUpperCase())
    patch.vehicleNumber = after.vehicleNumber.trim().toUpperCase();
  if (after.zone.trim() !== before.zone) patch.zone = after.zone.trim() || null;
  return patch;
}

/**
 * Edit a delivery partner: personal details, address, emergency contact, vehicle and zone. The
 * rider's email, mobile, documents and bank details are theirs to change.
 */
@Component({
  selector: 'bb-rider-account-edit',
  imports: [RouterLink, FormRoot, NP_FORM_FIELDS, IconComponent, ImageUpload, PhoneInput],
  templateUrl: './rider-account-edit.html',
  styleUrl: './rider-account-edit.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RiderAccountEdit {
  private readonly api = inject(AdminRiderAccountsService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  readonly id = input.required<string>();

  protected readonly shownError = shownError;
  protected readonly born = birthDateRange();
  protected readonly genderOptions = [
    { value: '', label: 'Not set' },
    ...(Object.keys(GENDER_LABEL) as Gender[]).map((g) => ({ value: g, label: GENDER_LABEL[g] })),
  ];
  protected readonly vehicleOptions = (Object.keys(VEHICLE_LABEL) as VehicleType[]).map((v) => ({
    value: v,
    label: VEHICLE_LABEL[v],
  }));

  private readonly account = rxResource({ params: () => this.id(), stream: ({ params }) => this.api.get(params) });
  protected readonly data = computed(() => loaded(this.account));
  protected readonly loadError = computed(() =>
    this.account.error() ? errorMessage(this.account.error(), 'Could not load this delivery partner.') : null,
  );
  protected readonly photo = linkedSignal(() => this.data()?.user.avatarUrl ?? '');
  private readonly model = signal(modelOf(undefined));
  protected readonly form = form(
    this.model,
    (p) => {
      requiredText(p.name, 'Name', { min: 2, max: 80 });
      requiredText(p.address.line1, 'Street address', { max: 200 });
      requiredText(p.address.city, 'City', { max: 80 });
      requiredText(p.address.state, 'State', { max: 80 });
      pattern(p.address.postalCode, POSTAL_CODE_PATTERN, { message: 'Enter a valid PIN code' });
      phoneRules(p.emergencyContact.phone, { optional: true });
      // A contact needs both a name and a phone (or neither, to remove it).
      validate(p.emergencyContact.phone, ({ value, valueOf }) =>
        valueOf(p.emergencyContact.name).trim() && !value()
          ? { kind: 'required', message: 'Add the contact’s phone number' }
          : undefined,
      );
      validate(p.emergencyContact.name, ({ value, valueOf }) =>
        valueOf(p.emergencyContact.phone) && !value().trim()
          ? { kind: 'required', message: 'Add the contact’s name' }
          : undefined,
      );
      maxLength(p.emergencyContact.relation, 40, { message: 'At most 40 characters' });
      maxLength(p.vehicleNumber, 20, { message: 'At most 20 characters' });
      maxLength(p.zone, 60, { message: 'At most 60 characters' });
    },
    { submission: { action: () => this.save() } },
  );
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const a = this.data();
      if (a && !untracked(() => this.form().dirty())) untracked(() => this.form().reset(modelOf(a)));
    });
  }

  private async save(): Promise<TreeValidationResult> {
    const a = this.data()!;
    const patch = changes(modelOf(a), this.model(), a.user.avatarUrl ?? '', this.photo());
    this.error.set(null);
    try {
      if (Object.keys(patch).length) {
        await firstValueFrom(this.api.update(this.id(), patch));
        this.notify.success('Delivery partner updated');
      }
      void this.router.navigate(['/admin/delivery-partner-accounts', this.id()]);
      return undefined;
    } catch (err) {
      const details = fieldErrors(err);
      if (!details.length) this.error.set(errorMessage(err));
      return serverErrors(this.form, details);
    }
  }
}
