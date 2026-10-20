/* Public statistics page: static, one fetch of stats.json. Data is rendered only through textContent.
   The render code (el, fmt, table, plot, renderSeries, bars, renderShare, theme) is intentionally
   mirrored from dashboard/app.js so both pages look and behave alike. */
(function () {
  "use strict";

  var SETTINGS = ["diffMethod", "force", "hierarchy", "mdxParser", "pretty", "telemetry"];
  var SERIES_COLORS = 8;
  var LABELS = { ci: { "0": "local", "1": "CI" }, formatter: { "": "not set" } };
  var THEME_KEY = "gqlmd-telemetry-theme";

  var root = document.documentElement;
  var status = document.getElementById("status");
  var statusDot = document.getElementById("statusDot");
  var rangeLabel = document.getElementById("rangeLabel");
  var updated = document.getElementById("updated");
  var panels = document.getElementById("panels");
  var charts = [];

  function el(tag, text, cls) {
    var node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  function fmt(n) { return Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 }); }
  function day(s) { return new Date(s + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); }
  function sum(totals) { return totals.reduce(function (s, t) { return s + t.n; }, 0); }
  function cssVar(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }
  function seriesVar(i) { return "--s" + ((i % SERIES_COLORS) + 1); }

  function setStatus(text, state) {
    status.textContent = text;
    statusDot.className = "dot" + (state ? " " + state : "");
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
    if (section.dataset.tag) head.appendChild(el("span", section.dataset.tag, "panel-tag"));
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

  function renderSeries(section, data) {
    var seen = Array.from(new Set(data.series.map(function (r) { return r.day; }))).sort();
    var values = data.totals.map(function (t) { return t.value; });
    // Days without rows are zero, not missing: fill every day between the first and the last
    // so the line does not interpolate across them (the export only carries days with data).
    var days = [];
    if (seen.length) {
      for (var ms = Date.parse(seen[0] + "T00:00:00Z"), end = Date.parse(seen[seen.length - 1] + "T00:00:00Z"); ms <= end; ms += 86400000) {
        days.push(new Date(ms).toISOString().slice(0, 10));
      }
    }
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

  function renderSettings(section, settings) {
    var byKey = {};
    settings.forEach(function (s) { byKey[s.key] = s; });
    var all = SETTINGS.map(function (key) { return byKey[key] || { totals: [], suppressed_count: 0 }; });
    var freq = all.map(function (d, i) {
      return { value: SETTINGS[i], n: sum(d.totals) };
    }).filter(function (t) { return t.n > 0; }).sort(function (a, b) { return b.n - a.n; });
    if (!freq.length) section.appendChild(noData());
    else section.appendChild(bars(freq, function (v) { return v; }));
    var rows = [];
    all.forEach(function (d, i) { d.totals.forEach(function (t) { rows.push([SETTINGS[i], t.value, fmt(t.n)]); }); });
    section.appendChild(details("Value distribution (enum and boolean settings)", table(["Setting", "Value", "Count"], rows, 2)));
    section.appendChild(suppressedNote(all.reduce(function (s, d) { return s + (d.suppressed_count || 0); }, 0)));
  }

  function kpi(name, d) {
    var value = document.querySelector('[data-kpi="' + name + '"]');
    var foot = document.querySelector('[data-kpi-foot="' + name + '"]');
    if (d.totals.length || !d.suppressed_count) {
      value.textContent = fmt(sum(d.totals));
    } else {
      value.textContent = "Suppressed";
      if (foot) foot.textContent = "Below the n<5 threshold";
    }
  }

  function render(data) {
    ["events", "configs", "debounced"].forEach(function (name) { kpi(name, data.kpis[name]); });
    Array.prototype.forEach.call(panels.querySelectorAll("section"), function (section) {
      reset(section);
      var d = data.panels[section.dataset.panel];
      if (section.dataset.kind === "settings") renderSettings(section, data.settings || []);
      else if (d) (section.dataset.kind === "series" ? renderSeries : renderShare)(section, d);
      else section.appendChild(noData());
    });
    rangeLabel.textContent = "Selected range · " + day(data.from) + " – " + day(data.to);
    var text = "Last updated " + data.generated.slice(0, 16).replace("T", " ") + " UTC (data from " + data.from + " to " + data.to + ")";
    updated.textContent = text;
    setStatus(text, "ok");
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
  setStatus("Loading...");
  fetch("stats.json").then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }).then(render).catch(function () {
    panels.textContent = "Statistics are unavailable.";
    setStatus("Unavailable", "error");
  });
})();
