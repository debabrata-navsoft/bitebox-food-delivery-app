import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import { IconComponent } from 'nexprime';

/** One line of a details card: an icon, the label on the left, the value on the right. */
export interface InfoRow {
  icon: string;
  label: string;
  value: string;
  /** `facts` only: a small line under the value. */
  note?: string;
}

/**
 * A label/value list for details pages (contact, owner, legal…), or with `facts` the strip of quick
 * facts along the bottom of a details page's hero (icon tile, label, value, optional note).
 */
@Component({
  selector: 'bb-info-rows',
  imports: [IconComponent],
  templateUrl: './info-rows.html',
  styleUrl: './info-rows.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.facts]': 'facts()' },
})
export class InfoRows {
  readonly rows = input.required<InfoRow[]>();
  readonly facts = input(false, { transform: booleanAttribute });
}
