import { FormControl, FormGroup } from '@angular/forms';
import { applyServerErrors, controlError, matchFields, passwordPolicy } from './form-validators';

describe('passwordPolicy', () => {
  const check = (value: string) => passwordPolicy(new FormControl(value));

  it('accepts a valid password', () => expect(check('Secret123')).toBeNull());
  it('ignores empty values (left to Validators.required)', () => expect(check('')).toBeNull());
  it('requires 8 characters', () => expect(check('Ab1')).toHaveProperty('minlength'));
  it('requires a letter', () => expect(check('12345678')).toHaveProperty('letter'));
  it('requires a number', () => expect(check('abcdefgh')).toHaveProperty('number'));
  it('rejects passwords over 72 bytes', () => expect(check('a1' + 'é'.repeat(40))).toHaveProperty('tooLong'));
});

describe('matchFields', () => {
  it('flags a mismatched confirmation and clears it once fixed', () => {
    const form = new FormGroup(
      { password: new FormControl('Secret123'), confirm: new FormControl('Other123') },
      { validators: matchFields('password', 'confirm') },
    );
    expect(form.controls.confirm.hasError('mismatch')).toBe(true);
    form.controls.confirm.setValue('Secret123');
    expect(form.controls.confirm.hasError('mismatch')).toBe(false);
  });
});

describe('applyServerErrors / controlError', () => {
  it('maps API field errors onto controls', () => {
    const form = new FormGroup({ email: new FormControl('taken@example.com') });
    applyServerErrors(form, [{ field: 'email', message: 'Email already used' }]);
    expect(controlError(form.controls.email, 'Email')).toBe('Email already used');
  });
});
