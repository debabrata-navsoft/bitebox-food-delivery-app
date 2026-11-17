import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { IconComponent, TabsComponent } from 'nexprime';

type Tab = { id: string; label: string; content: string; badge?: string | number };

/**
 * np-tabs on one line with ← → buttons when the tabs don't fit (account profiles have many).
 * The buttons show only when there is more to that side; the selected tab is scrolled into view.
 */
@Component({
  selector: 'bb-tab-strip',
  imports: [TabsComponent, IconComponent],
  templateUrl: './tab-strip.html',
  styleUrl: './tab-strip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabStrip {
  readonly tabs = input.required<Tab[]>();
  readonly activeTab = model.required<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly canBack = signal(false);
  protected readonly canForward = signal(false);
  private list: HTMLElement | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      this.list = this.host.nativeElement.querySelector('.tab-list');
      if (!this.list) return;
      const update = () => this.measure();
      this.list.addEventListener('scroll', update, { passive: true });
      const resize = new ResizeObserver(update);
      resize.observe(this.list);
      destroyRef.onDestroy(() => {
        resize.disconnect();
        this.list?.removeEventListener('scroll', update);
      });
      update();
    });
    // Keep the selected tab in view (and re-measure when the tabs change).
    effect(() => {
      const id = this.activeTab();
      this.tabs();
      queueMicrotask(() => {
        const tab = this.list?.querySelector<HTMLElement>(`[aria-selected="true"]`);
        tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        this.measure();
        void id;
      });
    });
  }

  protected scroll(direction: 1 | -1): void {
    if (!this.list) return;
    this.list.scrollBy({ left: direction * this.list.clientWidth * 0.8, behavior: 'smooth' });
  }

  private measure(): void {
    const l = this.list;
    if (!l) return;
    this.canBack.set(l.scrollLeft > 1);
    this.canForward.set(l.scrollLeft + l.clientWidth < l.scrollWidth - 1);
  }
}
