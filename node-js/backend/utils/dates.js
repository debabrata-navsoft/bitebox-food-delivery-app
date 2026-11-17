export const DAY_MS = 86_400_000;

/** The calendar date of `date` in a time zone: { year, month, day } (month 1-12). */
export function localDate(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  );
  return { year: parts.year, month: parts.month, day: parts.day };
}

const pad = (n) => String(n).padStart(2, "0");

/** "2026-11-05" in a time zone. */
export function localDay(date, timeZone) {
  const { year, month, day } = localDate(date, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "2026-11" in a time zone. */
export const localMonth = (date, timeZone) => localDay(date, timeZone).slice(0, 7);

/** How far a time zone's wall clock is ahead of UTC at `date`, in ms. */
function zoneOffset(date, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, Number(x.value)]),
  );
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant a calendar day ("2026-11-05") starts in a time zone. */
export function zoneDayStart(day, timeZone) {
  const [y, m, d] = day.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const guess = utc - zoneOffset(new Date(utc), timeZone);
  // Correct once in case the offset differs at the guessed instant (a DST change that day).
  return new Date(utc - zoneOffset(new Date(guess), timeZone));
}

/** "2026-11-05" -> "2026-11-06". */
export const nextDay = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
