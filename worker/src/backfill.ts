import { sendAlert } from "./alert";
import type { Env } from "./env";
import { rollupDay } from "./rollup";

/** Daily rollup of day D-1 (UTC). */
export const DAILY_CRON = "0 2 * * *";

/** Backfill tick, off the daily slot so the two never run at the same minute. */
export const BACKFILL_CRON = "5,15,25,35,45,55 * * * *";

/**
 * Oldest day the backfill accepts, in days before today. Analytics Engine keeps
 * raw events about 90 days; re-rolling a day past that would replace its D1
 * rows with empty ones, so a margin is kept.
 */
export const MAX_BACKFILL_AGE_DAYS = 88;

/** Failed tries before a queued day is dropped. */
export const MAX_BACKFILL_ATTEMPTS = 3;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day (2026-02-30 does not round-trip). */
const isDay = (day: string): boolean => {
  if (!ISO_DAY.test(day)) return false;
  const time = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === day;
};

const dayOffset = (now: number, days: number): string => {
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10);
};

/**
 * Roll up the oldest day in `rollup_backfill`, one per tick: a day already
 * takes about 30 Analytics Engine queries, close to the subrequest limit of
 * one invocation. Days outside [today - MAX_BACKFILL_AGE_DAYS, yesterday] are
 * dropped without touching their rows.
 */
export const backfillTick = async (env: Env, now: number): Promise<void> => {
  const next = await env.DB.prepare(
    "SELECT day, attempts FROM rollup_backfill ORDER BY day LIMIT 1",
  ).first<{ day: string; attempts: number }>();
  if (next === null) {
    return;
  }
  const { day, attempts } = next;
  const drop = env.DB.prepare("DELETE FROM rollup_backfill WHERE day = ?").bind(day);
  if (
    !isDay(day) ||
    day < dayOffset(now, MAX_BACKFILL_AGE_DAYS) ||
    day > dayOffset(now, 1)
  ) {
    await drop.run();
    await sendAlert(env, `gqlmd telemetry: backfill skipped ${day}, outside the Analytics Engine window`);
    return;
  }
  await env.DB.prepare("UPDATE rollup_backfill SET attempts = attempts + 1 WHERE day = ?")
    .bind(day)
    .run();
  try {
    await rollupDay(env, day);
  } catch (error) {
    if (attempts + 1 >= MAX_BACKFILL_ATTEMPTS) {
      await drop.run();
      // The message stays generic: no SQL, row or payload text leaves the Worker.
      await sendAlert(env, `gqlmd telemetry: backfill of ${day} (UTC) failed ${MAX_BACKFILL_ATTEMPTS} times, dropped`);
    }
    throw error;
  }
  await drop.run();
};
