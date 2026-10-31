-- Split generate error counts by ci ('0' local, '1' CI) so /v1/stats/generate
-- can filter its top errors by view. SQLite cannot change a primary key in
-- place, so the rows move to a new table. Existing rows have no ci and are
-- kept with ci = '' (unknown): only the All view counts them, until their day
-- is rolled up again. Safe to run twice: a re-run copies from the empty table
-- that 0004 recreates, then drops it again.
CREATE TABLE IF NOT EXISTS generate_errors_ci_daily (
  day TEXT NOT NULL,
  pkg_version TEXT NOT NULL,
  ci TEXT NOT NULL,
  error_type TEXT NOT NULL,
  runs REAL NOT NULL,
  PRIMARY KEY (day, pkg_version, ci, error_type)
);

INSERT OR IGNORE INTO generate_errors_ci_daily (day, pkg_version, ci, error_type, runs)
SELECT day, pkg_version, '', error_type, runs FROM generate_errors_daily;

DROP TABLE IF EXISTS generate_errors_daily;
