-- Daily generate-event stats. Quantiles are per (version, trigger, ci) row, so
-- readers combine rows as run-weighted averages (approximate) and apply n<5
-- on the summed `runs` over the selected range.
CREATE TABLE IF NOT EXISTS generate_daily (
  day TEXT NOT NULL,
  pkg_version TEXT NOT NULL,
  trigger TEXT NOT NULL,
  ci TEXT NOT NULL,
  runs REAL NOT NULL,
  failures REAL NOT NULL,
  pages_p50 REAL NOT NULL,
  pages_p95 REAL NOT NULL,
  duration_p50 REAL NOT NULL,
  duration_p95 REAL NOT NULL,
  PRIMARY KEY (day, pkg_version, trigger, ci)
);

CREATE TABLE IF NOT EXISTS generate_errors_daily (
  day TEXT NOT NULL,
  pkg_version TEXT NOT NULL,
  error_type TEXT NOT NULL,
  runs REAL NOT NULL,
  PRIMARY KEY (day, pkg_version, error_type)
);
