import { logger } from "../config/logger.js";

/**
 * Runs `sweep()` every `intervalMs`, the next run timed from the end of the last (never two at
 * once). With `onTheClock`, runs a second after each clock multiple of `intervalMs` instead
 * (every quarter hour: 12:00:01 AM, 12:15:01 AM...). Logs the summary when `hasWork(summary)`.
 * Returns a stop function (used on shutdown).
 */
export function startSweepLoop(name, sweep, intervalMs, hasWork, { onTheClock = false } = {}) {
  let timer;
  let stopped = false;
  const next = () => {
    const delay = onTheClock ? intervalMs - (Date.now() % intervalMs) + 1000 : intervalMs;
    timer = setTimeout(async () => {
      try {
        const summary = await sweep();
        if (hasWork(summary)) logger.info(summary, `${name} sweep`);
      } catch (error) {
        logger.error({ err: error }, `${name} sweep failed`);
      }
      if (!stopped) next();
    }, delay);
    timer.unref();
  };
  next();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
