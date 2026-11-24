import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { IconComponent } from 'nexprime';
import { DetailOrder } from '../../list/detail-order';

/**
 * The buttons above a details page, on the right: previous / next (in the order of the list it was
 * opened from) and Back. `backLink` is where Back goes when the page was opened directly.
 */
@Component({
  selector: 'bb-detail-nav',
  imports: [IconComponent],
  templateUrl: './detail-nav.html',
  styleUrl: './detail-nav.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailNav {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly order = inject(DetailOrder);

  /** The id shown (it is the URL's segment that previous / next swap). */
  readonly id = input.required<string>();
  readonly backLink = input.required<string | unknown[]>();

  protected readonly around = computed(() => this.order.around(this.id()));
  protected readonly arrows = [
    { step: -1, label: 'Previous', icon: 'chevron-left' },
    { step: 1, label: 'Next', icon: 'chevron-right' },
  ];

  protected go(to: string | null | undefined): void {
    if (!to) return;
    const path = this.router.url.split(/[?#]/)[0];
    // Replaces the entry, so Back still returns to the list (or wherever the admin came from).
    this.router.navigateByUrl(path.replace(`/${this.id()}`, `/${to}`), { replaceUrl: true });
  }

  /** The page the admin came from, or the list when the page was opened directly. */
  protected back(): void {
    if (this.router.lastSuccessfulNavigation()?.previousNavigation) this.location.back();
    else this.router.navigate(([] as unknown[]).concat(this.backLink()));
  }
}
