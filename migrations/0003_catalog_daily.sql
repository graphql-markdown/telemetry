-- Per-day config catalog counts, so range queries can apply the n<5 rule
-- within the range. config_catalog keeps the masked json and first/last seen.
CREATE TABLE IF NOT EXISTS config_catalog_daily (
  day TEXT NOT NULL,
  fp_shape TEXT NOT NULL,
  ci TEXT NOT NULL,
  events REAL NOT NULL,
  debounced_events REAL NOT NULL,
  PRIMARY KEY (day, fp_shape, ci)
);
