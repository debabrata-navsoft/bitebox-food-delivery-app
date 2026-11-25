import { Injector, afterNextRender, inject } from '@angular/core';
import { Observable, filter, takeUntil } from 'rxjs';

// Dialogs don't close on a click outside them: only their own buttons, or Escape (keyboards).
// A BbDialog can opt in with `closeOnOutsideClick` (e.g. the restaurant filters).
// BbDialog applies this as it opens a dialog; Material dialogs get it from the hook below.
// No dialog code is imported here, so the root component can call the hook cheaply.

/** Dialogs whose Escape key is off for now (`lockDialog`, e.g. while a payment processes). */
const locked = new WeakSet<object>();

/** Escape closes the dialog unless it is locked. */
export function closeOnEscape(ref: {
  keydownEvents: Observable<KeyboardEvent>;
  closed: Observable<unknown>;
  close(): void;
}): void {
  ref.keydownEvents
    .pipe(
      filter((e) => e.key === 'Escape' && !e.defaultPrevented && !locked.has(ref)),
      takeUntil(ref.closed),
    )
    .subscribe(() => ref.close());
}

/** Keeps a dialog open even on Escape, e.g. half-way through "processing". */
export const lockDialog = (ref: object): void => void locked.add(ref);

/**
 * Material dialogs (`MatDialog`, still used by older screens) get the same rule: a click outside
 * never closes them; Escape does unless they asked to stay open. Call once from the root component;
 * Material is loaded after the first render, so it stays out of the start-up bundle.
 */
export function keepMaterialDialogsOpenOnOutsideClick(): void {
  const injector = inject(Injector);
  afterNextRender(async () => {
    const { MatDialog } = await import('@angular/material/dialog');
    injector.get(MatDialog).afterOpened.subscribe((ref) => {
      if (ref.disableClose) return; // it already stays open on its own
      ref.disableClose = true;
      closeOnEscape({
        keydownEvents: ref.keydownEvents(),
        closed: ref.afterClosed(),
        close: () => ref.close(),
      });
    });
  });
}
