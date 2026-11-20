import { BreakpointObserver } from '@angular/cdk/layout';
import { Signal, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

/** The SCSS `desktop-up` breakpoint (`breakpoints.scss`). */
export const DESKTOP_UP = '(min-width: 1024px)';

/** Whether a CSS media query matches, as a signal. Call in an injection context. */
export function mediaQuery(query: string, initialValue = false): Signal<boolean> {
  return toSignal(
    inject(BreakpointObserver)
      .observe(query)
      .pipe(map((state) => state.matches)),
    {
      initialValue,
    },
  );
}
