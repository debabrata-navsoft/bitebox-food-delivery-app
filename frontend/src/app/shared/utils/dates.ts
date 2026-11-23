import { formatDate } from '@angular/common';
import { LOCALE_ID, inject } from '@angular/core';

const pad = (n: number) => String(n).padStart(2, '0');

/** A calendar day as the API sends it: "2026-11-17" (local date, no time zone shift). */
export const isoDay = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A date-of-birth picker's range: born 13 to `oldest` years ago (the API's age rule). */
export function birthDateRange(oldest = 120): { earliest: Date; latest: Date } {
  const t = new Date();
  return {
    earliest: new Date(t.getFullYear() - oldest, 0, 1),
    latest: new Date(t.getFullYear() - 13, t.getMonth(), t.getDate()),
  };
}

/**
 * "2026-11-17" as a local Date (for date pickers), or null. Takes the day part of a timestamp too
 * ("2026-11-17T00:00:00.000Z", as the Node API sends dates of birth) without a time zone shift.
 */
export const fromIsoDay = (day: string | null | undefined): Date | null => {
  const [y, m, d] = (day ?? '').slice(0, 10).split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};

type DateInput = string | number | Date | null | undefined;

/**
 * Dates as text in the app's locale, for strings built in TS (e.g. a table sub-line). Call in an
 * injection context: `day(at)` ("23 Nov 2026"; '' when missing), `day(at, 'd MMM, h:mm a')`, and
 * `range(from, to)` ("1 Nov – 30 Nov 2026"; an open end reads "from 1 Nov" / "until 30 Nov").
 */
export function dateText() {
  const locale = inject(LOCALE_ID);
  const day = (at: DateInput, format = 'd MMM y'): string =>
    at === null || at === undefined || at === '' ? '' : formatDate(at, format, locale);
  const range = (from: DateInput, to: DateInput, format = 'd MMM y'): string =>
    from && to
      ? `${day(from, format)} – ${day(to, format)}`
      : from
        ? `from ${day(from, format)}`
        : to
          ? `until ${day(to, format)}`
          : '';
  return { day, range };
}
