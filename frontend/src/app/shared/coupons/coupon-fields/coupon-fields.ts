import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FieldTree } from '@angular/forms/signals';
import { ButtonToggleComponent } from 'nexprime';
import { shownError } from '../../forms/form-errors';
import { NP_FORM_FIELDS } from '../../forms/np-form-fields';
import { AUDIENCE_OPTIONS, CouponFormModel, DISCOUNT_TYPE_OPTIONS } from '../coupon-form';

/**
 * The fields every coupon form has: name and code, the discount, limits, dates and terms.
 * Each dialog puts its own "where it applies" pickers in the content slot.
 */
@Component({
  selector: 'bb-coupon-fields',
  imports: [NP_FORM_FIELDS, ButtonToggleComponent],
  templateUrl: './coupon-fields.html',
  styleUrl: './coupon-fields.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CouponFields {
  readonly form = input.required<FieldTree<CouponFormModel>>();
  /** Editing an existing coupon: the code is required (a new one is generated when blank). */
  readonly editing = input(false);
  readonly namePlaceholder = input('');
  protected readonly shownError = shownError;
  protected readonly discountTypes = DISCOUNT_TYPE_OPTIONS;
  protected readonly audienceOptions = AUDIENCE_OPTIONS;
}
