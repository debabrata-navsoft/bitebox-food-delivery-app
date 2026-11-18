import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  PLATFORM_ID,
  afterNextRender,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import { IconComponent } from 'nexprime';

/**
 * Wraps a Leaflet map with a full-screen button, on every screen size. Uses the browser's
 * Fullscreen API where it exists and falls back to a fixed layer over the page (iPhone Safari has
 * no element full screen). The map inside resizes itself (its ResizeObserver).
 *
 * Content: the map element, plus optional `[mapActions]` shown in the full-screen header.
 */
@Component({
  selector: 'bb-map-frame',
  imports: [A11yModule, IconComponent],
  templateUrl: './map-frame.html',
  styleUrl: './map-frame.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.full]': 'full()',
    '[attr.role]': "full() ? 'dialog' : null",
    '[attr.aria-modal]': "full() ? 'true' : null",
    '[attr.aria-label]': 'full() ? title() : null',
    '(keydown.escape)': 'onEscape($event)',
  },
})
export class MapFrame {
  /** Heading of the full-screen view. */
  readonly title = input('Map');

  protected readonly full = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');
  private readonly openButton = viewChild<ElementRef<HTMLButtonElement>>('openBtn');
  /** Whether full screen came from the Fullscreen API (so leaving it must exit that too). */
  private native = false;

  /** Leaving native full screen with the browser's own Escape key or gesture. */
  private readonly onFullscreenChange = () => {
    if (this.document.fullscreenElement !== this.host.nativeElement) this.close();
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.close(false));
  }

  protected open(): void {
    if (!this.browser || this.full()) return;
    this.full.set(true);
    this.document.body.classList.add('bb-map-full-open');
    const el = this.host.nativeElement;
    if (this.document.fullscreenEnabled && el.requestFullscreen) {
      el.requestFullscreen().then(
        () => {
          this.native = true;
          this.document.addEventListener('fullscreenchange', this.onFullscreenChange);
        },
        () => undefined, // refused: the fixed layer is already showing
      );
    }
    afterNextRender(() => this.closeButton()?.nativeElement.focus(), { injector: this.injector });
  }

  protected close(refocus = true): void {
    if (!this.full()) return;
    if (this.native) {
      this.native = false;
      this.document.removeEventListener('fullscreenchange', this.onFullscreenChange);
      if (this.document.fullscreenElement === this.host.nativeElement) {
        void this.document.exitFullscreen().catch(() => undefined);
      }
    }
    this.full.set(false);
    this.document.body.classList.remove('bb-map-full-open');
    if (refocus) {
      afterNextRender(() => this.openButton()?.nativeElement.focus(), { injector: this.injector });
    }
  }

  /** Escape leaves full screen only; it must not also close a dialog the map sits in. */
  protected onEscape(event: Event): void {
    if (!this.full()) return;
    event.stopPropagation();
    this.close();
  }
}
