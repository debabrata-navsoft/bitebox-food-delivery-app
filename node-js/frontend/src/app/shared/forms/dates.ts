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
