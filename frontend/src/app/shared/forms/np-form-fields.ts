import { FormField } from '@angular/forms/signals';
import {
  CalendarComponent,
  InputNumberComponent,
  RatingComponent,
  SearchInputComponent,
  SelectComponent,
  TextInputComponent,
  TextareaComponent,
  TimePickerComponent,
} from 'nexprime';
import { FieldError } from './field-error/field-error';
import { CodeInput } from './code-input/code-input';
import { NpFieldTouch, NpUntouched } from '../directives/np-field-touch';
import { NpInputAttrs } from '../directives/np-input-attrs';

export const NP_FORM_FIELDS = [
  FormField,
  NpFieldTouch,
  NpUntouched,
  NpInputAttrs,
  FieldError,
  TextInputComponent,
  TextareaComponent,
  InputNumberComponent,
  RatingComponent,
  SelectComponent,
  SearchInputComponent,
  CalendarComponent,
  TimePickerComponent,
  CodeInput,
] as const;
