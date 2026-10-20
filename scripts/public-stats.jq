# Input: wrangler d1 execute --json output, an array whose [0].results rows are {dim, value, n}.
# Arg:   $min, rows with n < $min are suppressed (counted, never listed).
# Output: public stats JSON, all four dims always present.
(.[0].results // []) as $rows
| ["formatter", "graphqlMajor", "loader.kind", "pkgVersion"] as $dims
| {
    generated: (now | strftime("%Y-%m-%dT%H:%M:%SZ")),
    from: ((now - 89 * 86400) | strftime("%Y-%m-%d")),
    to: (now | strftime("%Y-%m-%d")),
    min_count: $min,
    dims: (
      [$dims[] as $d
        | ($rows | map(select(.dim == $d))) as $r
        | {
            key: $d,
            value: {
              totals: ($r | map(select(.n >= $min) | {value, n}) | sort_by(-.n)),
              suppressed_count: ($r | map(select(.n < $min)) | length)
            }
          }]
      | from_entries
    )
  }
