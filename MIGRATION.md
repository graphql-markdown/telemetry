# Migration: catalog rebuild

`config_catalog` and `config_catalog_daily` can be rebuilt from Analytics Engine. The rollup computes the catalog id from the normalized config, `loader` (blob7) and `formatter` (blob6), not from blob3, so rows written under an older masking merge with their current form. `fp_shape` in D1 therefore hashes the same inputs as ingest, and differs from blob3 only on those older rows and on truncated configs.

`config_catalog` only moves forward (`last_rolled_day`), so a re-roll does not rewrite it. To rebuild:

1. Check that the history fits the window: backfill drops days older than 88 days, and their catalog rows would be lost.

   ```sh
   scripts/query.sh d1 "SELECT MIN(first_seen), COUNT(*) FROM config_catalog"
   scripts/query.sh d1 "SELECT day, SUM(events), SUM(debounced_events) FROM config_catalog_daily GROUP BY day ORDER BY day"
   ```

2. Start after the 02:00 UTC rollup, so the whole window (at most about 15 hours) finishes before the next one. A rollup of a later day during the backfill would block the older days through `last_rolled_day`.
3. Note a restore point with `wrangler d1 time-travel info gqlmd-telemetry`. A restore also undoes any rollup run since.
4. Clear the tables and queue the days:

   ```sh
   scripts/query.sh d1 "DELETE FROM config_catalog_daily"
   scripts/query.sh d1 "DELETE FROM config_catalog"
   scripts/backfill.sh <first day> <yesterday>
   ```

5. Once `scripts/backfill.sh --status` is empty, compare the per-day `SUM(events)` with step 1. Distinct-config counts may fall; event totals must not.

The catalog panel of the dashboard is incomplete until the queue is empty. The public page does not read these tables.
