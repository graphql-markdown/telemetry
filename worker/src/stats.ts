import type { Env } from "./env";

/** Values with a total below this over the selected range are hidden. */
export const MIN_COUNT = 5;
export const MAX_RANGE_DAYS = 3650;
const DEFAULT_RANGE_DAYS = 90;
const CATALOG_LIMIT = 50;

/** Dimensions written by the rollup (see rollup.ts); `setting.<key>` is open-ended. */
export const DIMS = [
  "event",
  "pkgVersion",
  "formatter",
  "loader.kind",
  "os",
  "pm",
  "graphqlMajor",
  "ci",
  "ciProvider",
  "trigger",
  "container",
] as const;
export const MEASURES = ["raw", "debounced_1h", "debounced_1d", "quarantined"] as const;
export const VIEWS = ["local", "ci", "all"] as const;

const SETTING_DIM = /^setting\.[A-Za-z][A-Za-z0-9]{0,63}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export type Query = {
  dim: string;
  from: string;
  to: string;
  measure: (typeof MEASURES)[number];
  view: (typeof VIEWS)[number];
};
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

const bad = (error: string): Response => json({ error }, 400);

const dayMs = (day: string): number | undefined => {
  if (!ISO_DAY.test(day)) return undefined;
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== day ? undefined : ms;
};

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const oneOf = <T extends string>(list: readonly T[], value: string | null, fallback: T): T | undefined =>
  value === null ? fallback : list.find((item) => item === value);

/** Shared `from`/`to` parsing. Defaults to the last 90 days. */
const parseRange = (params: URLSearchParams): Parsed<{ from: string; to: string }> => {
  const toRaw = params.get("to");
  const toMs = toRaw === null ? Date.parse(isoDay(Date.now()) + "T00:00:00Z") : dayMs(toRaw);
  if (toMs === undefined) return { ok: false, error: "invalid to" };
  const fromRaw = params.get("from");
  const fromMs = fromRaw === null ? toMs - (DEFAULT_RANGE_DAYS - 1) * 86_400_000 : dayMs(fromRaw);
  if (fromMs === undefined) return { ok: false, error: "invalid from" };
  if (fromMs > toMs) return { ok: false, error: "from is after to" };
  if ((toMs - fromMs) / 86_400_000 > MAX_RANGE_DAYS) {
    return { ok: false, error: `range exceeds ${MAX_RANGE_DAYS} days` };
  }
  return { ok: true, value: { from: isoDay(fromMs), to: isoDay(toMs) } };
};

export const parseQuery = (params: URLSearchParams): Parsed<Query> => {
  const range = parseRange(params);
  if (!range.ok) return range;
  const dim = params.get("dim") ?? "";
  if (!(DIMS as readonly string[]).includes(dim) && !SETTING_DIM.test(dim)) {
    return { ok: false, error: "invalid dim" };
  }
  const measure = oneOf(MEASURES, params.get("measure"), "raw");
  if (measure === undefined) return { ok: false, error: "invalid measure" };
  const view = oneOf(VIEWS, params.get("view"), "local");
  if (view === undefined) return { ok: false, error: "invalid view" };
  return { ok: true, value: { dim, ...range.value, measure, view } };
};

/** `ci` column values for a view ('0' local, '1' CI). */
const ciOf = (view: Query["view"]): [string, string] =>
  view === "local" ? ["0", "0"] : view === "ci" ? ["1", "1"] : ["0", "1"];

/** SQL bucket expression for the `day` column; constant text, never user input. */
const bucketOf = (weekly: boolean): string =>
  weekly ? "date(day, 'weekday 0', '-6 days')" : "day";

/**
 * Aggregate one dimension over the range. Suppression (total < MIN_COUNT) is
 * applied after summing over the whole range, not per day.
 */
export const statsFor = async (env: Env, query: Query, weekly = false): Promise<Response> => {
  const [ciA, ciB] = ciOf(query.view);
  const { results } = await env.DB.prepare(
    `SELECT ${bucketOf(weekly)} AS day, value, SUM(n) AS n FROM daily_counts
     WHERE dim = ?1 AND measure = ?2 AND day >= ?3 AND day <= ?4 AND ci IN (?5, ?6)
     GROUP BY 1, value ORDER BY 1, value`,
  )
    .bind(query.dim, query.measure, query.from, query.to, ciA, ciB)
    .all<{ day: string; value: string; n: number }>();
  const totals = new Map<string, number>();
  for (const row of results) {
    totals.set(row.value, (totals.get(row.value) ?? 0) + row.n);
  }
  const shown = new Set([...totals].filter(([, n]) => n >= MIN_COUNT).map(([value]) => value));
  return json({
    dim: query.dim,
    measure: query.measure,
    view: query.view,
    from: query.from,
    to: query.to,
    granularity: weekly ? "week" : "day",
    series: results.filter((row) => shown.has(row.value)),
    totals: [...totals]
      .filter(([value]) => shown.has(value))
      .map(([value, n]) => ({ value, n }))
      .sort((a, b) => b.n - a.n),
    suppressed_count: totals.size - shown.size,
    min_count: MIN_COUNT,
  });
};

/**
 * Top masked config shapes by in-range debounced events. Daily rows are summed
 * over the range first, then shapes under MIN_COUNT are hidden.
 */
const catalog = async (env: Env, params: URLSearchParams): Promise<Response> => {
  const range = parseRange(params);
  if (!range.ok) return bad(range.error);
  const view = oneOf(VIEWS, params.get("view"), "local");
  if (view === undefined) return bad("invalid view");
  const { from, to } = range.value;
  const [ciA, ciB] = ciOf(view);
  const ranged = `SELECT fp_shape, SUM(events) AS events, SUM(debounced_events) AS debounced_events
     FROM config_catalog_daily WHERE day BETWEEN ?1 AND ?2 AND ci IN (?3, ?4) GROUP BY fp_shape`;
  const { results } = await env.DB.prepare(
    `SELECT c.masked_config_json, c.versions_seen, c.first_seen, c.last_seen, r.events, r.debounced_events
     FROM (${ranged}) r JOIN config_catalog c ON c.fp_shape = r.fp_shape
     WHERE r.debounced_events >= ?5
     ORDER BY r.debounced_events DESC LIMIT ?6`,
  )
    .bind(from, to, ciA, ciB, MIN_COUNT, CATALOG_LIMIT)
    .all<{
      masked_config_json: string;
      versions_seen: string;
      first_seen: string;
      last_seen: string;
      events: number;
      debounced_events: number;
    }>();
  const hidden = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM (${ranged}) WHERE debounced_events < ?5`,
  )
    .bind(from, to, ciA, ciB, MIN_COUNT)
    .first<{ c: number }>();
  return json({
    from,
    to,
    configs: results.map((row) => {
      let config: unknown = null;
      try {
        config = JSON.parse(row.masked_config_json);
      } catch {
        // keep null
      }
      return {
        config,
        versions: row.versions_seen === "" ? [] : row.versions_seen.split(","),
        first_seen: row.first_seen,
        last_seen: row.last_seen,
        events: row.events,
        debounced_events: row.debounced_events,
      };
    }),
    suppressed_count: hidden?.c ?? 0,
    min_count: MIN_COUNT,
  });
};

/** Payload-free reject counters by day and reason. */
const rejects = async (env: Env, params: URLSearchParams): Promise<Response> => {
  const range = parseRange(params);
  if (!range.ok) return bad(range.error);
  const { from, to } = range.value;
  const { results } = await env.DB.prepare(
    "SELECT day, reason, n FROM rejects_daily WHERE day >= ?1 AND day <= ?2 ORDER BY day, reason",
  )
    .bind(from, to)
    .all<{ day: string; reason: string; n: number }>();
  const totals = new Map<string, number>();
  for (const row of results) {
    totals.set(row.reason, (totals.get(row.reason) ?? 0) + row.n);
  }
  return json({
    from,
    to,
    series: results,
    totals: [...totals].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n),
  });
};

/** Handles `/v1/stats`, `/v1/stats/catalog` and `/v1/stats/rejects` (GET, already authorized). */
export const handleStats = async (url: URL, env: Env): Promise<Response> => {
  switch (url.pathname) {
    case "/v1/stats": {
      const query = parseQuery(url.searchParams);
      return query.ok ? statsFor(env, query.value) : bad(query.error);
    }
    case "/v1/stats/catalog":
      return catalog(env, url.searchParams);
    case "/v1/stats/rejects":
      return rejects(env, url.searchParams);
    default:
      return new Response("Not Found", { status: 404 });
  }
};

/**
 * Optional public aggregates (`PUBLIC_STATS=true`), no Access. Reads no request
 * header. Always the raw measure, the local view and weekly buckets, with the
 * same n < 5 suppression; quarantined events are never part of `raw`.
 */
export const handlePublic = async (url: URL, env: Env): Promise<Response> => {
  if (env.PUBLIC_STATS !== "true") {
    return new Response("Not Found", { status: 404 });
  }
  if (url.pathname === "/public") {
    const page = await env.ASSETS?.fetch(new Request(new URL("/public.html", url)));
    return page && page.ok ? new Response(page.body, page) : new Response("Not Found", { status: 404 });
  }
  if (url.pathname === "/public/v1/stats") {
    const query = parseQuery(url.searchParams);
    if (!query.ok) return bad(query.error);
    return statsFor(env, { ...query.value, measure: "raw", view: "local" }, true);
  }
  return new Response("Not Found", { status: 404 });
};
