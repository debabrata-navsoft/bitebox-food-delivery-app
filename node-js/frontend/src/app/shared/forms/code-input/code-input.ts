import { ChangeDetectionStrategy, Component, ElementRef, inject, input } from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { InputOtpComponent } from 'nexprime';
import { FieldError } from '../field-error/field-error';
import { NpUntouched } from '../np-field-touch';

/**
 * A 6-digit one-time code (email or SMS): one box per digit, with its error underneath. Filling the
 * last box submits the surrounding form.
 */
@Component({
  selector: 'bb-code-input',
  imports: [FormField, NpUntouched, InputOtpComponent, FieldError],
  templateUrl: './code-input.html',
  styleUrl: './code-input.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'bb-field' },
})
export class CodeInput {
  readonly field = input.required<FieldTree<string>>();
  readonly label = input('6-digit code');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected submit(): void {
    this.host.closest('form')?.requestSubmit();
  }
}
