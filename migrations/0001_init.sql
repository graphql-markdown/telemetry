-- Rollup tables, filled by the daily cron (worker/src/rollup.ts).

-- One row per (day, dimension, value, measure). `value` is always an enum or
-- a mask token. `measure` is raw, debounced_1h, debounced_1d or quarantined.
CREATE TABLE IF NOT EXISTS daily_counts (
  day TEXT NOT NULL,
  dim TEXT NOT NULL,
  value TEXT NOT NULL,
  measure TEXT NOT NULL,
  n REAL NOT NULL,
  PRIMARY KEY (day, dim, value, measure)
);

-- One row per masked config shape, kept beyond Analytics Engine retention.
-- `last_rolled_day` makes the additive upsert idempotent: a day already
-- applied is skipped.
CREATE TABLE IF NOT EXISTS config_catalog (
  fp_shape TEXT PRIMARY KEY,
  masked_config_json TEXT NOT NULL,
  versions_seen TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  events REAL NOT NULL,
  debounced_events REAL NOT NULL,
  last_rolled_day TEXT NOT NULL
);

-- Reject counters by reason, no payload fields.
CREATE TABLE IF NOT EXISTS rejects_daily (
  day TEXT NOT NULL,
  reason TEXT NOT NULL,
  n REAL NOT NULL,
  PRIMARY KEY (day, reason)
);
