-- Anonymise pkgVersion: drop the patch and prerelease (1.2.3 -> 1.2, 1.2.3-rc.1 -> 1.2).
-- Existing rows are rewritten and rows that collapse onto the same key are
-- merged. Already truncated values and unknown-value are left unchanged, so
-- the migration is safe to run twice. Scratch tables are plain tables and are
-- dropped at the end.
DROP TABLE IF EXISTS _pkgv_map;
DROP TABLE IF EXISTS _pkgv_dc;
DROP TABLE IF EXISTS _pkgv_gd;
DROP TABLE IF EXISTS _pkgv_ge;

CREATE TABLE _pkgv_map (
  old TEXT PRIMARY KEY,
  new TEXT NOT NULL
);

INSERT OR IGNORE INTO _pkgv_map (old, new)
SELECT value, value FROM daily_counts WHERE dim = 'pkgVersion'
UNION SELECT pkg_version, pkg_version FROM generate_daily
UNION SELECT pkg_version, pkg_version FROM generate_errors_daily
UNION SELECT j.value, j.value FROM config_catalog,
  json_each('["' || replace(config_catalog.versions_seen, ',', '","') || '"]') AS j
  WHERE config_catalog.versions_seen <> '';

-- Keep X.Y: everything before the second dot (also drops any prerelease).
UPDATE _pkgv_map SET
  new = substr(old, 1, instr(old, '.') + instr(substr(old, instr(old, '.') + 1), '.') - 1)
WHERE old GLOB '[0-9]*.[0-9]*.[0-9]*';

CREATE TABLE _pkgv_dc AS
SELECT d.day AS day, d.ci AS ci, d.dim AS dim, m.new AS value, d.measure AS measure, SUM(d.n) AS n
FROM daily_counts d JOIN _pkgv_map m ON m.old = d.value
WHERE d.dim = 'pkgVersion'
GROUP BY d.day, d.ci, d.dim, m.new, d.measure;

DELETE FROM daily_counts WHERE dim = 'pkgVersion';

INSERT INTO daily_counts (day, ci, dim, value, measure, n)
SELECT day, ci, dim, value, measure, n FROM _pkgv_dc;

CREATE TABLE _pkgv_gd AS
SELECT g.day AS day, m.new AS pkg_version, g.trigger AS trigger, g.ci AS ci,
  SUM(g.runs) AS runs, SUM(g.failures) AS failures,
  CASE WHEN SUM(g.runs) = 0 THEN MAX(g.pages_p50) ELSE SUM(g.pages_p50 * g.runs) / SUM(g.runs) END AS pages_p50,
  CASE WHEN SUM(g.runs) = 0 THEN MAX(g.pages_p95) ELSE SUM(g.pages_p95 * g.runs) / SUM(g.runs) END AS pages_p95,
  CASE WHEN SUM(g.runs) = 0 THEN MAX(g.duration_p50) ELSE SUM(g.duration_p50 * g.runs) / SUM(g.runs) END AS duration_p50,
  CASE WHEN SUM(g.runs) = 0 THEN MAX(g.duration_p95) ELSE SUM(g.duration_p95 * g.runs) / SUM(g.runs) END AS duration_p95
FROM generate_daily g JOIN _pkgv_map m ON m.old = g.pkg_version
GROUP BY g.day, m.new, g.trigger, g.ci;

DELETE FROM generate_daily;

INSERT INTO generate_daily (day, pkg_version, trigger, ci, runs, failures, pages_p50, pages_p95, duration_p50, duration_p95)
SELECT day, pkg_version, trigger, ci, runs, failures, pages_p50, pages_p95, duration_p50, duration_p95 FROM _pkgv_gd;

CREATE TABLE _pkgv_ge AS
SELECT e.day AS day, m.new AS pkg_version, e.error_type AS error_type, SUM(e.runs) AS runs
FROM generate_errors_daily e JOIN _pkgv_map m ON m.old = e.pkg_version
GROUP BY e.day, m.new, e.error_type;

DELETE FROM generate_errors_daily;

INSERT INTO generate_errors_daily (day, pkg_version, error_type, runs)
SELECT day, pkg_version, error_type, runs FROM _pkgv_ge;

UPDATE config_catalog SET versions_seen = COALESCE((
  SELECT group_concat(v, ',') FROM (
    SELECT DISTINCT m.new AS v
    FROM json_each('["' || replace(config_catalog.versions_seen, ',', '","') || '"]') AS j
    JOIN _pkgv_map m ON m.old = j.value
    ORDER BY v
  )
), '')
WHERE versions_seen <> '';

DROP TABLE _pkgv_dc;
DROP TABLE _pkgv_gd;
DROP TABLE _pkgv_ge;
DROP TABLE _pkgv_map;
