import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Provider, Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER } from 'rxjs';
import { RealtimeService } from '../../core/services/realtime.service';
import { FilterValue } from '../components/filter-panel/filter-panel.models';

// Spec helpers for the pages built on `filteredList` (imported by specs only).

/** A page of rows in the API's envelope, with any extra fields (counts, summary, balances). */
export const page = (items: unknown[] = [], extra: object = {}) => ({
  success: true,
  message: '',
  data: { ...extra, items, pagination: { page: 1, limit: 20, total: items.length, totalPages: 1 } },
});

/** Filter changes reload after a short pause. */
export const settle = () => new Promise((r) => setTimeout(r, 350));

let lastHttp: HttpTestingController | undefined;
/** For `afterEach`: no request of the last page was left unanswered. */
export const verifyHttp = () => lastHttp?.verify();

/** The part of a `filteredList` a spec drives. */
export interface ListHandle {
  panel: { set(v: FilterValue): void };
}

/**
 * A list page with a fake API and a silent socket, its inputs set and first rendered. `path` is the
 * end of the list's URL: `list()` expects its one request, `applyFilters()` sets panel filters and
 * returns the reload.
 */
export async function listPage<T>(
  component: Type<T>,
  path: string,
  opts: { inputs?: Record<string, unknown>; providers?: Provider[] } = {},
) {
  await TestBed.configureTestingModule({
    imports: [component],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: RealtimeService, useValue: { orderUpdates$: NEVER } },
      ...(opts.providers ?? []),
    ],
  }).compileComponents();
  const http = (lastHttp = TestBed.inject(HttpTestingController));
  const fixture: ComponentFixture<T> = TestBed.createComponent(component);
  for (const [name, value] of Object.entries(opts.inputs ?? {}))
    fixture.componentRef.setInput(name, value);
  fixture.detectChanges();
  const list = (): TestRequest => http.expectOne((r) => r.url.endsWith(path));
  return {
    fixture,
    http,
    list,
    text: () => (fixture.nativeElement as HTMLElement).textContent ?? '',
    applyFilters: async (handle: ListHandle, value: FilterValue): Promise<TestRequest> => {
      handle.panel.set(value);
      fixture.detectChanges();
      await settle();
      return list();
    },
  };
}
