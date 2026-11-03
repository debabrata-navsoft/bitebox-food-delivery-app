import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** A headline number with its label (and an optional hint underneath). */
@Component({
  selector: 'bb-stat-tile',
  imports: [MatIconModule],
  templateUrl: './stat-tile.html',
  styleUrl: './stat-tile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatTile {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly icon = input<string>();
  readonly hint = input<string>();
}
