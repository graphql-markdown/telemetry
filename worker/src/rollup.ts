import type { Env } from "./env";
import { VALUE_STRINGS } from "./schema";

/** At most this many `daily_counts` rows (and catalog rows) are written per day. */
export const MAX_ROWS_PER_DAY = 2000;

const MEASURES = ["raw", "debounced_1h", "debounced_1d"] as const;

/** Single-blob dimensions: dimension name and its blob column (see `buildBlobs`). */
const BLOB_DIMS: ReadonlyArray<readonly [string, string]> = [
  ["event", "blob1"],
  ["pkgVersion", "blob5"],
  ["formatter", "blob6"],
  ["os", "blob8"],
  ["pm", "blob9"],
  ["graphqlMajor", "blob11"],
  ["ci", "blob12"],
  ["ciProvider", "blob13"],
  ["trigger", "blob14"],
  ["container", "blob15"],
];

type Row = Record<string, string | number>;
type Counts = Map<string, number>;
type CountRow = { ci: string; dim: string; value: string; measure: string; n: number };

/** UTC day (YYYY-MM-DD) before the given instant. */
export const previousDay = (now: number): string => {
  return new Date(now - 86_400_000).toISOString().slice(0, 10);
};

const nextDay = (day: string): string => {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
};

const dayWindow = (day: string): string => {
  return (
    `timestamp >= toDateTime('${day} 00:00:00') ` +
    `AND timestamp < toDateTime('${nextDay(day)} 00:00:00')`
  );
};

/** Not quarantined (blob17 is the quarantined flag). */
const CLEAN = "blob17 = '0'";

const MEASURE_COLUMNS =
  "SUM(_sample_interval * double1) AS raw, " +
  "count(DISTINCT (blob2, toStartOfHour(timestamp))) AS debounced_1h, " +
  "count(DISTINCT blob2) AS debounced_1d";

const dimSql = (column: string, day: string, extra = ""): string => {
  return (
    `SELECT ${column} AS value, blob12 AS ci, ${MEASURE_COLUMNS} FROM gqlmd_events ` +
    `WHERE ${dayWindow(day)} AND ${CLEAN}${extra} GROUP BY value, ci`
  );
};

/** Colo-sampled events (blob17 = '2'), kept at 1/50 and weighted by double1. */
const coloSql = (column: string, day: string, extra = ""): string => {
  return (
    `SELECT ${column} AS value, blob12 AS ci, SUM(_sample_interval * double1) AS colo_sampled ` +
    `FROM gqlmd_events WHERE ${dayWindow(day)} AND blob17 = '2'${extra} GROUP BY value, ci`
  );
};

/** The create target (blob19) only exists on these events; skip the empty value. */
const TARGET_FILTER = " AND blob1 IN ('create_scaffold', 'create_wire') AND blob19 != ''";

const quarantinedSql = (day: string): string => {
  return (
    `SELECT blob1 AS value, blob12 AS ci, SUM(_sample_interval * double1) AS n ` +
    `FROM gqlmd_events WHERE ${dayWindow(day)} AND blob17 = '1' GROUP BY value, ci`
  );
};

const catalogSql = (day: string): string => {
  return (
    `SELECT blob3 AS fp_shape, blob12 AS ci, blob5 AS version, blob18 AS config, ` +
    `SUM(_sample_interval * double1) AS events, ` +
    `count(DISTINCT (blob2, toStartOfHour(timestamp))) AS debounced ` +
    `FROM gqlmd_events WHERE ${dayWindow(day)} AND ${CLEAN} ` +
    `AND blob1 = 'config' GROUP BY fp_shape, ci, version, config`
  );
};

const rejectsSql = (day: string): string => {
  return (
    `SELECT blob1 AS reason, SUM(_sample_interval * double1) AS n ` +
    `FROM gqlmd_rejects WHERE ${dayWindow(day)} GROUP BY reason`
  );
};

const query = async (env: Env, sql: string): Promise<Row[]> => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${env.AE_SQL_TOKEN}` },
      body: sql,
    },
  );
  if (!response.ok) {
    throw new Error(`Analytics Engine SQL API answered ${response.status}`);
  }
  const body = (await response.json()) as { data?: Row[] };
  return body.data ?? [];
};

const KEY_SEP = "\u0000";

const add = (counts: Counts, key: string, n: number): void => {
  counts.set(key, (counts.get(key) ?? 0) + n);
};

const addMeasures = (counts: Counts, dim: string, value: string, row: Row): void => {
  for (const measure of MEASURES) {
    add(counts, [String(row.ci), dim, value, measure].join(KEY_SEP), Number(row[measure] ?? 0));
  }
};

const addColo = (counts: Counts, dim: string, value: string, row: Row): void => {
  add(counts, [String(row.ci), dim, value, "colo_sampled"].join(KEY_SEP), Number(row.colo_sampled ?? 0));
};

/** Top-level config keys whose value is an enum or mask token (or a boolean). */
const settingsOf = (config: string): Array<[string, string]> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(config);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [];
  }
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "boolean") {
      out.push([key, String(value)]);
    } else if (typeof value === "string" && VALUE_STRINGS.has(value)) {
      out.push([key, value]);
    }
  }
  return out;
};

type Shape = {
  config: string;
  versions: Set<string>;
  events: number;
  debounced: number;
};

const mergeVersions = (previous: string, added: Iterable<string>): string => {
  const all = new Set(previous === "" ? [] : previous.split(","));
  for (const version of added) {
    all.add(version);
  }
  return [...all].sort().join(",");
};

const CHUNK = 50;

/**
 * Roll up one UTC day from Analytics Engine into D1. Idempotent: the day's
 * `daily_counts` and `rejects_daily` rows are deleted and re-inserted in one
 * batch, and the catalog skips a day it already applied. Returns the number of
 * non-quarantined `config` events (for the alert).
 */
export const rollupDay = async (env: Env, day: string): Promise<number> => {
  const counts: Counts = new Map();
  let configEvents = 0;

  for (const [dim, column] of BLOB_DIMS) {
    for (const row of await query(env, dimSql(column, day))) {
      const value = String(row.value);
      addMeasures(counts, dim, value, row);
      if (dim === "event" && value === "config") {
        configEvents += Number(row.raw ?? 0);
      }
    }
    for (const row of await query(env, coloSql(column, day))) {
      addColo(counts, dim, String(row.value), row);
    }
  }
  // Loader kinds: split the comma list. Each fp has one list, so the
  // distinct counts of different lists are disjoint and can be summed.
  const kindsOf = (value: string): Set<string> =>
    new Set(
      value
        .split(",")
        .filter((kind) => kind !== ""),
    );
  for (const row of await query(env, dimSql("blob7", day))) {
    for (const kind of kindsOf(String(row.value))) {
      addMeasures(counts, "loader.kind", kind, row);
    }
  }
  for (const row of await query(env, coloSql("blob7", day))) {
    for (const kind of kindsOf(String(row.value))) {
      addColo(counts, "loader.kind", kind, row);
    }
  }
  for (const row of await query(env, dimSql("blob18", day))) {
    for (const [key, value] of settingsOf(String(row.value))) {
      addMeasures(counts, `setting.${key}`, value, row);
    }
  }
  for (const row of await query(env, coloSql("blob18", day))) {
    for (const [key, value] of settingsOf(String(row.value))) {
      addColo(counts, `setting.${key}`, value, row);
    }
  }
  for (const row of await query(env, dimSql("blob19", day, TARGET_FILTER))) {
    if (String(row.value) !== "") {
      addMeasures(counts, "target", String(row.value), row);
    }
  }
  for (const row of await query(env, coloSql("blob19", day, TARGET_FILTER))) {
    if (String(row.value) !== "") {
      addColo(counts, "target", String(row.value), row);
    }
  }
  for (const row of await query(env, quarantinedSql(day))) {
    add(counts, [String(row.ci), "event", String(row.value), "quarantined"].join(KEY_SEP), Number(row.n));
  }

  const shapes = new Map<string, Shape>();
  const dailyShapes = new Map<string, { events: number; debounced: number }>();
  for (const row of await query(env, catalogSql(day))) {
    const id = String(row.fp_shape);
    const shape = shapes.get(id) ?? {
      config: String(row.config),
      versions: new Set<string>(),
      events: 0,
      debounced: 0,
    };
    const dailyKey = [id, String(row.ci)].join(KEY_SEP);
    const daily = dailyShapes.get(dailyKey) ?? { events: 0, debounced: 0 };
    daily.events += Number(row.events);
    daily.debounced += Number(row.debounced);
    dailyShapes.set(dailyKey, daily);
    shape.versions.add(String(row.version));
    shape.events += Number(row.events);
    shape.debounced += Number(row.debounced);
    shapes.set(id, shape);
  }
  const rejects = await query(env, rejectsSql(day));

  // Cardinality guard: keep the largest rows.
  const rows: CountRow[] = [...counts].map(([key, n]) => {
    const [ci, dim, value, measure] = key.split(KEY_SEP);
    return { ci, dim, value, measure, n };
  });
  rows.sort((a, b) => b.n - a.n);
  const kept = rows.slice(0, MAX_ROWS_PER_DAY);
  const keptShapes = [...shapes]
    .sort((a, b) => b[1].events - a[1].events)
    .slice(0, MAX_ROWS_PER_DAY);

  const db = env.DB;
  const existing = new Map<string, string>();
  for (let i = 0; i < keptShapes.length; i += CHUNK) {
    const ids = keptShapes.slice(i, i + CHUNK).map(([id]) => id);
    const { results } = await db
      .prepare(
        `SELECT fp_shape, versions_seen FROM config_catalog WHERE fp_shape IN (${ids
          .map(() => "?")
          .join(",")})`,
      )
      .bind(...ids)
      .all<{ fp_shape: string; versions_seen: string }>();
    for (const row of results) {
      existing.set(row.fp_shape, row.versions_seen);
    }
  }

  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM daily_counts WHERE day = ?").bind(day),
    db.prepare("DELETE FROM rejects_daily WHERE day = ?").bind(day),
    db.prepare("DELETE FROM config_catalog_daily WHERE day = ?").bind(day),
  ];
  const keptDaily = [...dailyShapes]
    .sort((a, b) => b[1].events - a[1].events)
    .slice(0, MAX_ROWS_PER_DAY);
  for (const [key, daily] of keptDaily) {
    const [id, ci] = key.split(KEY_SEP);
    statements.push(
      db
        .prepare(
          "INSERT INTO config_catalog_daily (day, fp_shape, ci, events, debounced_events) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(day, id, ci, daily.events, daily.debounced),
    );
  }
  for (const row of kept) {
    statements.push(
      db
        .prepare(
          "INSERT INTO daily_counts (day, ci, dim, value, measure, n) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(day, row.ci, row.dim, row.value, row.measure, row.n),
    );
  }
  for (const row of rejects) {
    statements.push(
      db
        .prepare("INSERT INTO rejects_daily (day, reason, n) VALUES (?, ?, ?)")
        .bind(day, String(row.reason), Number(row.n)),
    );
  }
  // Additive upsert, applied once per day: the WHERE skips a day that was
  // already rolled (or an older one), so re-runs do not double count.
  for (const [id, shape] of keptShapes) {
    statements.push(
      db
        .prepare(
          `INSERT INTO config_catalog (fp_shape, masked_config_json, versions_seen, first_seen, last_seen, events, debounced_events, last_rolled_day)
           VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?4)
           ON CONFLICT(fp_shape) DO UPDATE SET
             versions_seen = excluded.versions_seen,
             last_seen = excluded.last_seen,
             events = config_catalog.events + excluded.events,
             debounced_events = config_catalog.debounced_events + excluded.debounced_events,
             last_rolled_day = excluded.last_rolled_day
           WHERE config_catalog.last_rolled_day < excluded.last_rolled_day`,
        )
        .bind(
          id,
          shape.config,
          mergeVersions(existing.get(id) ?? "", shape.versions),
          day,
          shape.events,
          shape.debounced,
        ),
    );
  }
  await db.batch(statements);
  return configEvents;
};
