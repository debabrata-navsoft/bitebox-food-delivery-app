import { Directive, inject } from '@angular/core';
import { FormField } from '@angular/forms/signals';

/**
 * Signal Forms passes `invalid` to NexPrime controls at once; styles.scss shows the red border only
 * once the field is touched (blur, or a submit attempt marks every field touched).
 */
@Directive({
  selector:
    'np-text-input[formField], np-textarea[formField], np-input-number[formField], np-select[formField], np-calendar[formField], np-time-picker[formField], np-rating[formField], np-input-otp[formField]',
  host: { '[class.bb-untouched]': '!formField.state().touched()' },
})
export class NpUntouched {
  protected readonly formField = inject(FormField);
}

/**
 * Marks a NexPrime field touched when focus leaves it (NexPrime has no `touch` output). Not on code
 * boxes: people leave them to read the code in their mail or SMS app, so their error shows only
 * after a submit attempt.
 */
@Directive({
  selector:
    'np-text-input[formField], np-textarea[formField], np-input-number[formField], np-select[formField], np-calendar[formField], np-time-picker[formField], np-rating[formField]',
  host: { '(focusout)': 'onFocusOut($event)' },
})
export class NpFieldTouch {
  private readonly formField = inject(FormField);
  private readonly host = this.formField.element;

  protected onFocusOut(event: FocusEvent): void {
    if (event.relatedTarget instanceof Node && this.host.contains(event.relatedTarget)) return;
    this.formField.state().markAsTouched();
  }
}
