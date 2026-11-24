import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';

/**
 * The BiteBox loader: the logo's box with its lid bouncing open, and dashes running along a
 * track under it. `overlay` covers the page (a slow page change); otherwise it sits inline.
 * Pure SVG and CSS, so it is cheap enough for the app shell. index.html shows the same
 * markup as a boot splash before Angular starts (keep the two alike).
 */
@Component({
  selector: 'bb-brand-loader',
  templateUrl: './brand-loader.html',
  styleUrl: './brand-loader.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'status',
    'aria-live': 'polite',
    '[class.overlay]': 'overlay()',
  },
})
export class BrandLoader {
  readonly overlay = input(false, { transform: booleanAttribute });
  readonly label = input('Loading');
}
