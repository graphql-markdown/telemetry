# Input: wrangler d1 execute --json output, an array whose [0].results rows are {day, ci, dim, measure, value, n}.
# Arg:   $min, a value whose range total is below $min is suppressed (counted, never listed).
# Output: dashboard-shaped public stats JSON (version 2), every key always present.
(.[0].results // []) as $rows
| ["0"] as $local
| ["1"] as $ci
| ["0", "1"] as $all
# One panel: rows of dim+measure in the given ci views (optionally only the listed values),
# suppression by range total, then daily series and range totals.
| def sel($dim; $measure; $views; $vals):
    $rows | map(select(
      .ci as $c | .value as $v
      | .dim == $dim and .measure == $measure
      and (($views | index($c | tostring)) != null)
      and ($vals == null or ($vals | index($v)) != null)
    ));
  def totals_of: group_by(.value) | map({value: .[0].value, n: (map(.n) | add)});
  def totals($sel): ($sel | totals_of) as $t
    | ($t | map(select(.n >= $min)) | sort_by([-.n, .value])) as $keep
    | {totals: $keep, suppressed_count: (($t | length) - ($keep | length))};
  def panel($dim; $measure; $views; $vals):
    sel($dim; $measure; $views; $vals) as $r
    | totals($r) as $t
    | ($t.totals | map(.value)) as $shown
    | {
        series: (
          $r | map(select(.value as $v | $shown | index($v) != null))
          | group_by([.day, .value])
          | map({day: .[0].day, value: .[0].value, n: (map(.n) | add)})
        ),
        totals: $t.totals,
        suppressed_count: $t.suppressed_count
      };
  {
    version: 2,
    generated: (now | strftime("%Y-%m-%dT%H:%M:%SZ")),
    from: ((now - 89 * 86400) | strftime("%Y-%m-%d")),
    to: (now | strftime("%Y-%m-%d")),
    min_count: $min,
    kpis: {
      events: panel("event"; "raw"; $local; null),
      configs: panel("event"; "debounced_1d"; $local; null),
      debounced: panel("event"; "debounced_1d"; $local; null)
    },
    panels: {
      versions: panel("pkgVersion"; "raw"; $local; null),
      ci: panel("ci"; "raw"; $all; null),
      provider: panel("ciProvider"; "raw"; $ci; null),
      formatter: panel("formatter"; "raw"; $local; null),
      graphql: panel("graphqlMajor"; "raw"; $local; null),
      loader: panel("loader.kind"; "raw"; $local; null),
      create: panel("event"; "raw"; $local; ["create_scaffold", "create_wire"]),
      targets: panel("target"; "raw"; $local; null)
    },
    settings: [
      ["diffMethod", "force", "hierarchy", "mdxParser", "pretty", "telemetry"][] as $k
      | panel("setting." + $k; "raw"; $local; null) as $p
      | {key: $k, totals: $p.totals, suppressed_count: $p.suppressed_count}
    ]
  }
