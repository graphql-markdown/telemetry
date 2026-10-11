/** Worker bindings (see worker/wrangler.jsonc). */
export interface Env {
  /** Analytics Engine dataset `gqlmd_events`: one data point per accepted event. */
  EVENTS: AnalyticsEngineDataset;
  /** Analytics Engine dataset `gqlmd_rejects`: reject counters, no payload fields. */
  REJECTS: AnalyticsEngineDataset;
  /** D1 database holding the daily rollups. */
  DB: D1Database;
  /** Secret: API token with Account Analytics Read, for the AE SQL API. */
  AE_SQL_TOKEN: string;
  /** Secret: Cloudflare account ID (AE SQL API path). */
  ACCOUNT_ID: string;
  /** Secret, optional: Discord/Slack-compatible webhook for the no-events alert. */
  ALERT_WEBHOOK?: string;
  /** Rate limit per `(fp, colo)`: 100 per 60 s. Tripping it starts a quarantine. */
  RL?: RateLimit;
  /** Per-colo limit, independent of the payload: 2000 per 60 s, checked before parsing. */
  RL_COLO?: RateLimit;
  /** Hard ceiling per `(fp, colo)`: 1000 per 60 s; above it events are sampled 1/20 and flagged. */
  RL_HARD?: RateLimit;
  /** Comma-separated retired payload versions (answered with 410). Empty by default. */
  RETIRED_VERSIONS?: string;
}

export type RejectReason =
  | "schema"
  | "schema-version"
  | "size"
  | "encoding"
  | "rate-limit"
  | "rate-limit-colo"
  | "sampled-out";
