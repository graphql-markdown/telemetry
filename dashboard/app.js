/* Telemetry dashboard: no build step. Data is rendered only through textContent. */
(function () {
  "use strict";

  var SETTINGS = ["diffMethod", "force", "hierarchy", "mdxParser", "pretty", "telemetry"];
  var SERIES_COLORS = 8; /* --s1..--s8 in style.css, from the website palette */
  var LABELS = { ci: { "0": "local", "1": "CI" }, formatter: { "": "not set" } };
  var THEME_KEY = "gqlmd-telemetry-theme";

  var root = document.documentElement;
  var form = document.getElementById("controls");
  var status = document.getElementById("status");
  var statusDot = document.getElementById("statusDot");
  var rangeLabel = document.getElementById("rangeLabel");
  var charts = [];
  var generation = 0;

  function el(tag, text, cls) {
    var node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  function iso(date) { return date.toISOString().slice(0, 10); }
  function fmt(n) { return Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 }); }
  function day(s) { return new Date(s + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); }
  function sum(totals) { return totals.reduce(function (s, t) { return s + t.n; }, 0); }
  function cssVar(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }
  function seriesVar(i) { return "--s" + ((i % SERIES_COLORS) + 1); }

  function setStatus(text, state) {
    status.textContent = text;
    statusDot.className = "dot" + (state ? " " + state : "");
  }

  function params() {
    var kind = form.elements.measure.value;
    var measure = kind === "events" ? "raw" : kind === "configs" ? "debounced_1d" : kind === "colo_sampled" ? "colo_sampled" : "debounced_1d";
    var to = new Date();
    var from = new Date(to.getTime() - (Number(form.elements.range.value) - 1) * 86400000);
    return { from: iso(from), to: iso(to), measure: measure, view: form.elements.view.value };
  }

  function get(path, query) {
    var qs = new URLSearchParams(query).toString();
    return fetch(path + "?" + qs, { credentials: "same-origin" }).then(function (res) {
      if (!res.ok) throw new Error(path + " answered " + res.status);
      return res.json();
    });
  }

  function table(headers, rows, numericFrom) {
    var wrap = el("div", undefined, "table-wrap");
    var t = el("table");
    var head = el("tr");
    headers.forEach(function (h, i) { head.appendChild(el("th", h, i >= numericFrom ? "num" : "")); });
    var thead = el("thead"); thead.appendChild(head); t.appendChild(thead);
    var body = el("tbody");
    rows.forEach(function (row) {
      var tr = el("tr");
      row.forEach(function (cell, i) { tr.appendChild(el("td", String(cell), i >= numericFrom ? "num" : "")); });
      body.appendChild(tr);
    });
    t.appendChild(body);
    wrap.appendChild(t);
    return wrap;
  }
  function details(summary, node) {
    var d = el("details"); d.appendChild(el("summary", summary)); d.appendChild(node); return d;
  }
  function empty(title, text, cls) {
    var box = el("div", undefined, "empty" + (cls ? " " + cls : ""));
    box.appendChild(el("strong", title));
    box.appendChild(el("span", text));
    return box;
  }
  function noData() { return empty("No data in this range", "Every value is suppressed (n<5) or nothing was recorded."); }
  function suppressedNote(n) {
    return el("div", n > 0 ? n + " value(s) hidden (n<5)" : "n<5 suppressed", "privacy");
  }
  function reset(section) {
    section.textContent = "";
    var head = el("div", undefined, "panel-head");
    var titles = el("div");
    titles.appendChild(el("h4", section.dataset.title));
    if (section.dataset.sub) titles.appendChild(el("div", section.dataset.sub, "panel-sub"));
    head.appendChild(titles);
    if (section.dataset.search) {
      var search = el("input", undefined, "search");
      search.type = "search";
      search.name = section.dataset.panel + "Search";
      search.placeholder = section.dataset.search;
      search.setAttribute("aria-label", section.dataset.search);
      head.appendChild(search);
    } else if (section.dataset.tag) {
      head.appendChild(el("span", section.dataset.tag, "panel-tag"));
    }
    section.appendChild(head);
  }
  function labelOf(section, value) {
    var map = LABELS[section.dataset.labels];
    return map && map[value] !== undefined ? map[value] : value;
  }

  function plot(chart) {
    var ink = cssVar("--muted");
    var grid = cssVar("--line");
    var axis = { stroke: ink, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 } };
    chart.plot = new window.uPlot({
      width: Math.max(260, chart.holder.clientWidth), height: 240,
      series: [{ label: "Date", value: "{YYYY}-{MM}-{DD}" }].concat(chart.labels.map(function (label, i) {
        var color = cssVar(seriesVar(i));
        return { label: label, stroke: color, width: 2, points: { size: 5, fill: color } };
      })),
      tzDate: function (ts) { return window.uPlot.tzDate(new Date(ts * 1000), "Etc/UTC"); },
      axes: [
        Object.assign({}, axis, { incrs: [86400, 172800, 604800], values: [[86400, "{M}/{D}", null, null, null, null, null, null, 1]] }),
        axis,
      ],
    }, chart.cols, chart.holder);
  }

  /* The API only returns days that have rows. Fill every day between the first and the last with
     zero, otherwise a day without runs vanishes from the axis and the line is drawn across it. */
  function fillDays(days) {
    var out = [];
    if (!days.length) return out;
    for (var ms = Date.parse(days[0] + "T00:00:00Z"), end = Date.parse(days[days.length - 1] + "T00:00:00Z"); ms <= end; ms += 86400000) {
      out.push(iso(new Date(ms)));
    }
    return out;
  }

  function renderSeries(section, data) {
    var days = fillDays(Array.from(new Set(data.series.map(function (r) { return r.day; }))).sort());
    var values = data.totals.map(function (t) { return t.value; });
    if (!days.length) { section.appendChild(noData()); section.appendChild(suppressedNote(data.suppressed_count)); return; }
    var lookup = {};
    data.series.forEach(function (r) { lookup[r.day + "|" + r.value] = r.n; });
    var cols = [days.map(function (d) { return Date.parse(d + "T00:00:00Z") / 1000; })];
    values.forEach(function (v) { cols.push(days.map(function (d) { return lookup[d + "|" + v] || 0; })); });
    var holder = el("div", undefined, "chart");
    section.appendChild(holder);
    if (window.uPlot) {
      var chart = { holder: holder, cols: cols, labels: values.map(function (v) { return labelOf(section, v); }) };
      plot(chart);
      charts.push(chart);
    }
    var headers = ["Day"].concat(values.map(function (v) { return labelOf(section, v); }));
    var rows = days.map(function (d) { return [d].concat(values.map(function (v) { return fmt(lookup[d + "|" + v] || 0); })); });
    section.appendChild(details("Data table", table(headers, rows, 1)));
    section.appendChild(suppressedNote(data.suppressed_count));
  }

  function bars(totals, label) {
    var max = Math.max.apply(null, totals.map(function (t) { return t.n; }).concat([1]));
    var ul = el("ul", undefined, "bars");
    totals.forEach(function (t, i) {
      var li = el("li");
      var name = label(t.value);
      var text = el("span", name, "label");
      text.title = name;
      li.appendChild(text);
      var track = el("span", undefined, "track");
      track.setAttribute("aria-hidden", "true");
      var bar = el("span", undefined, "bar");
      bar.style.width = Math.max(2, (t.n / max) * 100) + "%";
      bar.style.background = "var(" + seriesVar(i) + ")";
      track.appendChild(bar);
      li.appendChild(track);
      li.appendChild(el("span", fmt(t.n), "n"));
      ul.appendChild(li);
    });
    return ul;
  }

  function renderShare(section, data) {
    var only = section.dataset.only ? section.dataset.only.split(",") : null;
    var totals = data.totals.filter(function (t) { return !only || only.indexOf(t.value) !== -1; });
    if (!totals.length) { section.appendChild(noData()); }
    else {
      var label = function (v) { return labelOf(section, v); };
      section.appendChild(bars(totals, label));
      section.appendChild(details("Data table", table(["Value", "Count"], totals.map(function (t) { return [label(t.value), fmt(t.n)]; }), 1)));
    }
    section.appendChild(suppressedNote(data.suppressed_count));
  }

  function renderSettings(section, query) {
    return Promise.all(SETTINGS.map(function (key) {
      return get("/v1/stats", Object.assign({ dim: "setting." + key }, query));
    })).then(function (all) {
      var freq = all.map(function (d, i) {
        return { value: SETTINGS[i], n: sum(d.totals) };
      }).filter(function (t) { return t.n > 0; }).sort(function (a, b) { return b.n - a.n; });
      if (!freq.length) section.appendChild(noData());
      else section.appendChild(bars(freq, function (v) { return v; }));
      var rows = [];
      all.forEach(function (d, i) { d.totals.forEach(function (t) { rows.push([SETTINGS[i], t.value, fmt(t.n)]); }); });
      section.appendChild(details("Value distribution (enum and boolean settings)", table(["Setting", "Value", "Count"], rows, 2)));
      section.appendChild(suppressedNote(all.reduce(function (s, d) { return s + d.suppressed_count; }, 0)));
    });
  }

  function renderCatalog(section, data) {
    var rows = data.configs.map(function (c) {
      return [JSON.stringify(c.config), c.versions.join(", "), c.first_seen, c.last_seen, fmt(c.events), fmt(c.debounced_events)];
    });
    if (!rows.length) { section.appendChild(noData()); section.appendChild(suppressedNote(data.suppressed_count)); return; }
    var wrap = table(["Masked config", "Versions", "First seen", "Last seen", "Events", "Debounced"], rows, 4);
    wrap.querySelectorAll("td:first-child").forEach(function (td) {
      var pre = el("pre", td.textContent); td.textContent = ""; td.appendChild(pre);
    });
    var search = section.querySelector(".search");
    if (search) {
      search.addEventListener("input", function () {
        var q = search.value.toLowerCase();
        wrap.querySelectorAll("tbody tr").forEach(function (tr) {
          tr.classList.toggle("hidden", q !== "" && tr.textContent.toLowerCase().indexOf(q) === -1);
        });
      });
    }
    section.appendChild(wrap);
    section.appendChild(suppressedNote(data.suppressed_count));
  }

  function renderGenerate(section, data) {
    if (data.runs === null && !data.versions.length) {
      section.appendChild(noData());
    } else {
      var dash = function (v) { return v === null ? "-" : fmt(v); };
      section.appendChild(table(["Metric", "p50", "p95"], [
        ["Duration (ms)", dash(data.duration_p50), dash(data.duration_p95)],
        ["Pages", dash(data.pages_p50), dash(data.pages_p95)],
      ], 1));
      var rows = data.versions.map(function (v) { return [v.version, fmt(v.runs), fmt(v.failures), (v.failure_rate * 100).toFixed(1) + "%"]; });
      section.appendChild(table(["Version", "Runs", "Failures", "Failure rate"], rows, 1));
      if (data.errors.length) {
        section.appendChild(details("Top error types", bars(data.errors.map(function (e) { return { value: e.error_type, n: e.runs }; }), function (v) { return v; })));
      }
      section.appendChild(el("p", "Successful runs only. Percentiles are approximate: run-weighted averages of per-day, per-version, per-trigger, per-CI percentiles, which understate p95 when slow runs are concentrated.", "note"));
    }
    section.appendChild(suppressedNote(data.suppressed_count));
  }

  function renderHealth(section, query) {
    return Promise.all([
      get("/v1/stats/rejects", { from: query.from, to: query.to }),
      get("/v1/stats", { dim: "event", from: query.from, to: query.to, measure: "quarantined", view: "all" }),
    ]).then(function (res) {
      var rows = res[0].totals.map(function (t) { return ["rejected: " + t.reason, fmt(t.n)]; });
      rows.push(["quarantined events (excluded from other panels)", fmt(sum(res[1].totals))]);
      section.appendChild(table(["Counter", "Count"], rows, 1));
      section.appendChild(el("div", "Quarantined shows only when the total reaches 5 per event type.", "privacy"));
    });
  }

  function load(section, query) {
    reset(section);
    var kind = section.dataset.kind;
    var q = Object.assign({}, query);
    if (section.dataset.view) q.view = section.dataset.view;
    var done;
    if (kind === "settings") done = renderSettings(section, q);
    else if (kind === "health") done = renderHealth(section, q);
    else if (kind === "generate") done = get("/v1/stats/generate", { from: q.from, to: q.to, view: q.view }).then(function (d) { renderGenerate(section, d); });
    else if (kind === "catalog") done = get("/v1/stats/catalog", { from: q.from, to: q.to }).then(function (d) { renderCatalog(section, d); });
    else done = get("/v1/stats", Object.assign({ dim: section.dataset.dim }, q)).then(function (d) {
      (kind === "series" ? renderSeries : renderShare)(section, d);
    });
    return done.catch(function (err) { section.appendChild(empty("Could not load", err.message, "error")); throw err; });
  }

  function kpi(name, value, foot) {
    document.querySelector('[data-kpi="' + name + '"]').textContent = value;
    if (foot) document.querySelector('[data-kpi-foot="' + name + '"]').textContent = foot;
  }

  function loadKpis(query) {
    var base = { dim: "event", from: query.from, to: query.to, view: query.view };
    var jobs = [
      ["events", Object.assign({}, base, { measure: "raw" }), "Raw events · " + query.view + " view"],
      ["configs", Object.assign({}, base, { measure: "debounced_1d" }), "Sum of daily distinct configs"],
      ["debounced", Object.assign({}, base, { measure: "debounced_1d" }), "Debounced 1d · " + query.view + " view"],
      ["quarantined", Object.assign({}, base, { measure: "quarantined", view: "all" }), "All views · excluded from usage panels"],
    ];
    return Promise.all(jobs.map(function (job) {
      kpi(job[0], "—");
      return get("/v1/stats", job[1]).then(function (d) {
        if (d.totals.length || !d.suppressed_count) kpi(job[0], fmt(sum(d.totals)), job[2]);
        else kpi(job[0], "Suppressed", "Below the n<5 threshold");
      }, function (err) { kpi(job[0], "—", "Could not load"); throw err; });
    }));
  }

  function settle(promises) {
    return Promise.all(promises.map(function (p) { return p.then(function () { return true; }, function () { return false; }); }));
  }

  function refresh() {
    var query = params();
    rangeLabel.textContent = "Selected range · " + day(query.from) + " – " + day(query.to);
    setStatus("Loading...");
    charts.forEach(function (c) { c.plot.destroy(); });
    charts = [];
    var run = ++generation;
    var jobs = [loadKpis(query)].concat(Array.prototype.map.call(document.querySelectorAll("#panels section"), function (s) { return load(s, query); }));
    settle(jobs).then(function (ok) {
      if (run !== generation) return;
      var failed = ok.filter(function (x) { return !x; }).length;
      var summary = query.measure.replace("_", " ") + " · " + query.view;
      if (failed) setStatus(failed + " panel(s) failed · " + summary, "error");
      else setStatus("Live · " + summary, "ok");
    });
  }

  function redraw() {
    charts.forEach(function (c) { c.plot.destroy(); plot(c); });
  }

  function storedTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }
  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") root.dataset.theme = theme;
    else delete root.dataset.theme;
  }
  document.getElementById("themeButton").addEventListener("click", function () {
    var current = root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* per-viewer convenience only */ }
    redraw();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { if (!root.dataset.theme) redraw(); });

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      charts.forEach(function (c) { c.plot.setSize({ width: Math.max(260, c.holder.clientWidth), height: 240 }); });
    }, 150);
  });

  applyTheme(storedTheme());
  form.addEventListener("change", refresh);
  form.addEventListener("submit", function (e) { e.preventDefault(); refresh(); });
  refresh();
})();
