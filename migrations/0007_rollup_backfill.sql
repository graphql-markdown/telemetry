-- Days queued for a re-roll (scripts/backfill.sh). The backfill cron rolls up
-- the oldest queued day per tick and removes it; `attempts` counts failed
-- tries so a day that keeps failing is dropped instead of retried forever.
CREATE TABLE IF NOT EXISTS rollup_backfill (
  day TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0
);
