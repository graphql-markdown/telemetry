-- Split daily_counts by ci ('0' local, '1' CI). SQLite cannot change a primary
-- key in place, so the table is rebuilt. daily_counts is derived data: days
-- still inside Analytics Engine retention can be re-rolled.
DROP TABLE IF EXISTS daily_counts;

CREATE TABLE daily_counts (
  day TEXT NOT NULL,
  ci TEXT NOT NULL,
  dim TEXT NOT NULL,
  value TEXT NOT NULL,
  measure TEXT NOT NULL,
  n REAL NOT NULL,
  PRIMARY KEY (day, ci, dim, value, measure)
);
