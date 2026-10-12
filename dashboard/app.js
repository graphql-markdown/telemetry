/* Telemetry dashboard: no build step. Data is rendered only through textContent. */
(function () {
  "use strict";

  var SETTINGS = ["diffMethod", "force", "hierarchy", "mdxParser", "pretty", "telemetry"];
  var PALETTE = ["#2f6fed", "#e8590c", "#2f9e44", "#ae3ec9", "#f08c00", "#1098ad", "#c2255c", "#868e96"];
  var LABELS = { ci: { "0": "local", "1": "CI" } };

  var form = document.getElementById("controls");
  var status = document.getElementById("status");
  var charts = [];

  function el(tag, text, cls) {
    var node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  function iso(date) { return date.toISOString().slice(0, 10); }
  function fmt(n) { return Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 }); }

  function params() {
    var kind = form.elements.measure.value;
    var measure = kind === "events" ? "raw" : kind === "configs" ? "debounced_1d" : kind === "colo_sampled" ? "colo_sampled" : "debounced_" + document.getElementById("interval").value;
    return { from: form.elements.from.value, to: form.elements.to.value, measure: measure, view: form.elements.view.value };
  }

  function get(path, query) {
    var qs = new URLSearchParams(query).toString();
    return fetch(path + "?" + qs, { credentials: "same-origin" }).then(function (res) {
      if (!res.ok) throw new Error(path + " answered " + res.status);
      return res.json();
    });
  }

  function table(headers, rows, numericFrom) {
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
    return t;
  }
  function details(summary, node) {
    var d = el("details"); d.appendChild(el("summary", summary)); d.appendChild(node); return d;
  }
  function suppressedNote(n) {
    return el("p", n > 0 ? n + " value(s) hidden (n<5)" : "n<5 suppressed", "note");
  }
  function reset(section) {
    section.textContent = "";
    section.appendChild(el("h2", section.dataset.title));
  }
  function labelOf(section, value) {
    var map = LABELS[section.dataset.labels];
    return map && map[value] !== undefined ? map[value] : value;
  }

  function renderSeries(section, data) {
    var days = Array.from(new Set(data.series.map(function (r) { return r.day; }))).sort();
    var values = data.totals.map(function (t) { return t.value; });
    if (!days.length) { section.appendChild(el("p", "No data (suppressed or empty).", "note")); section.appendChild(suppressedNote(data.suppressed_count)); return; }
    var lookup = {};
    data.series.forEach(function (r) { lookup[r.day + "|" + r.value] = r.n; });
    var cols = [days.map(function (d) { return Date.parse(d + "T00:00:00Z") / 1000; })];
    values.forEach(function (v) { cols.push(days.map(function (d) { return lookup[d + "|" + v] || 0; })); });
    var holder = el("div", undefined, "chart");
    section.appendChild(holder);
    if (window.uPlot) {
      var dark = matchMedia("(prefers-color-scheme: dark)").matches;
      var ink = dark ? "#e6eaf0" : "#1b1f24";
      var grid = dark ? "#2d3640" : "#d5dbe3";
      var opts = {
        width: Math.max(300, section.clientWidth - 40), height: 240,
        series: [{}].concat(values.map(function (v, i) {
          return { label: labelOf(section, v), stroke: PALETTE[i % PALETTE.length], width: 2 };
        })),
        axes: [{ stroke: ink, grid: { stroke: grid } }, { stroke: ink, grid: { stroke: grid } }],
      };
      charts.push(new window.uPlot(opts, cols, holder));
    }
    var headers = ["Day"].concat(values.map(function (v) { return labelOf(section, v); }));
    var rows = days.map(function (d) { return [d].concat(values.map(function (v) { return fmt(lookup[d + "|" + v] || 0); })); });
    section.appendChild(details("Data table", table(headers, rows, 1)));
    section.appendChild(suppressedNote(data.suppressed_count));
  }

  function bars(totals, label) {
    var max = Math.max.apply(null, totals.map(function (t) { return t.n; }).concat([1]));
    var ul = el("ul", undefined, "bars");
    totals.forEach(function (t) {
      var li = el("li");
      li.appendChild(el("span", label(t.value)));
      var bar = el("span", undefined, "bar");
      bar.style.width = Math.max(2, (t.n / max) * 100) + "%";
      bar.setAttribute("aria-hidden", "true");
      li.appendChild(bar);
      li.appendChild(el("span", fmt(t.n), "n"));
      ul.appendChild(li);
    });
    return ul;
  }

  function renderShare(section, data) {
    var only = section.dataset.only ? section.dataset.only.split(",") : null;
    var totals = data.totals.filter(function (t) { return !only || only.indexOf(t.value) !== -1; });
    if (!totals.length) { section.appendChild(el("p", "No data (suppressed or empty).", "note")); }
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
        return { value: SETTINGS[i], n: d.totals.reduce(function (s, t) { return s + t.n; }, 0) };
      }).filter(function (t) { return t.n > 0; }).sort(function (a, b) { return b.n - a.n; });
      if (!freq.length) section.appendChild(el("p", "No data (suppressed or empty).", "note"));
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
    var t = table(["Masked config", "Versions", "First seen", "Last seen", "Events", "Debounced"], rows, 4);
    t.querySelectorAll("td:first-child").forEach(function (td) {
      var pre = el("pre", td.textContent); td.textContent = ""; td.appendChild(pre);
    });
    section.appendChild(t);
    section.appendChild(suppressedNote(data.suppressed_count));
  }

  function renderGenerate(section, data) {
    if (data.runs === null && !data.versions.length) {
      section.appendChild(el("p", "No data (suppressed or empty).", "note"));
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
      section.appendChild(el("p", "Percentiles are run-weighted averages of daily values.", "note"));
    }
    section.appendChild(suppressedNote(data.suppressed_count));
  }

  function renderHealth(section, query) {
    return Promise.all([
      get("/v1/stats/rejects", { from: query.from, to: query.to }),
      get("/v1/stats", { dim: "event", from: query.from, to: query.to, measure: "quarantined", view: "all" }),
    ]).then(function (res) {
      var rows = res[0].totals.map(function (t) { return ["rejected: " + t.reason, fmt(t.n)]; });
      var q = res[1].totals.reduce(function (s, t) { return s + t.n; }, 0);
      rows.push(["quarantined events (excluded from other panels)", fmt(q)]);
      section.appendChild(table(["Counter", "Count"], rows, 1));
      section.appendChild(el("p", "Quarantined shows only when the total reaches 5 per event type.", "note"));
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
    return done.catch(function (err) { section.appendChild(el("p", "Could not load: " + err.message, "note")); });
  }

  function refresh() {
    var query = params();
    if (!query.from || !query.to || query.from > query.to) { status.textContent = "Pick a valid date range."; return; }
    status.textContent = "Loading...";
    charts.forEach(function (c) { c.destroy(); });
    charts = [];
    Promise.all(Array.prototype.map.call(document.querySelectorAll("#panels section"), function (s) { return load(s, query); }))
      .then(function () { status.textContent = "Range " + query.from + " to " + query.to + ", measure " + query.measure + ", view " + query.view + "."; });
  }

  var today = new Date();
  form.elements.to.value = iso(today);
  form.elements.from.value = iso(new Date(today.getTime() - 89 * 86400000));
  form.addEventListener("change", refresh);
  form.addEventListener("submit", function (e) { e.preventDefault(); refresh(); });
  refresh();
})();
