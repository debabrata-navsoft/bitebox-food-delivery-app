import { AbstractControl, FormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';
import { ApiFieldError } from '../models/api.models';

/** Mirrors the backend password policy so users get instant feedback. */
export const passwordPolicy: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = String(control.value ?? '');
  if (!value) return null;
  const errors: ValidationErrors = {};
  if (value.length < 8) errors['minlength'] = { requiredLength: 8 };
  if (!/[A-Za-z]/.test(value)) errors['letter'] = true;
  if (!/[0-9]/.test(value)) errors['number'] = true;
  if (new TextEncoder().encode(value).length > 72) errors['tooLong'] = true;
  return Object.keys(errors).length ? errors : null;
};

export const PHONE_PATTERN = /^\+?[0-9]{10,15}$/;

/** Group validator: `confirmField` must equal `field`. Error is set on the confirm control. */
export const matchFields =
  (field: string, confirmField: string): ValidatorFn =>
  (group: AbstractControl): ValidationErrors | null => {
    const confirm = group.get(confirmField);
    if (!confirm) return null;
    const mismatch = group.get(field)?.value !== confirm.value;
    const { mismatch: _drop, ...rest } = confirm.errors ?? {};
    if (mismatch && confirm.value) confirm.setErrors({ ...rest, mismatch: true });
    else confirm.setErrors(Object.keys(rest).length ? rest : null);
    return null;
  };

/** Puts server-side (422) validation messages onto the matching form controls. */
export function applyServerErrors(form: FormGroup, errors: ApiFieldError[]): void {
  for (const { field, message } of errors) {
    const control = form.get(field);
    control?.setErrors({ ...(control.errors ?? {}), server: message });
    control?.markAsTouched();
  }
}

/** First user-facing message for a control's errors. */
export function controlError(control: AbstractControl | null, label = 'This field'): string {
  const errors = control?.errors;
  if (!errors) return '';
  if (errors['server']) return String(errors['server']);
  if (errors['required']) return `${label} is required`;
  if (errors['email']) return 'Enter a valid email address';
  if (errors['minlength']) return `${label} must be at least ${errors['minlength'].requiredLength} characters`;
  if (errors['maxlength']) return `${label} must be at most ${errors['maxlength'].requiredLength} characters`;
  if (errors['letter']) return 'Include at least one letter';
  if (errors['number']) return 'Include at least one number';
  if (errors['tooLong']) return 'Password is too long';
  if (errors['pattern']) return `Enter a valid ${label.toLowerCase()}`;
  if (errors['mismatch']) return 'Passwords do not match';
  return `${label} is invalid`;
}
