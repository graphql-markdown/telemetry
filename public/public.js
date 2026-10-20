(function () {
  var DIMS = [["formatter", "Formatter"], ["graphqlMajor", "GraphQL major"], ["loader.kind", "Loader kinds"], ["pkgVersion", "Versions"]];
  var THEME_KEY = "gqlmd-telemetry-theme";
  var root = document.documentElement;
  var out = document.getElementById("out");
  var updated = document.getElementById("updated");

  function storedTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }
  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") { root.dataset.theme = theme; }
    else { delete root.dataset.theme; }
  }
  var themeButton = document.getElementById("themeButton");
  if (themeButton) {
    themeButton.addEventListener("click", function () {
      var cur = root.dataset.theme;
      var next = cur === "light" ? "dark" : (cur === "dark" ? "" : "light"); /* system -> light -> dark */
      applyTheme(next);
      try {
        if (next) { localStorage.setItem(THEME_KEY, next); } else { localStorage.removeItem(THEME_KEY); }
      } catch (e) { /* per-viewer convenience only */ }
    });
  }
  applyTheme(storedTheme());

  fetch("stats.json").then(function (r) {
    if (!r.ok) { throw new Error("HTTP " + r.status); }
    return r.json();
  }).then(function (data) {
    updated.textContent = "Last updated " + data.generated.slice(0, 16).replace("T", " ") + " UTC (data from " + data.from + " to " + data.to + ")";
    DIMS.forEach(function (d) {
      var card = document.createElement("section"); card.className = "card";
      var h = document.createElement("h2"); h.textContent = d[1]; card.appendChild(h);
      var t = document.createElement("table");
      var head = t.insertRow();
      ["Value", "Events (90 days)"].forEach(function (x, i) { var c = document.createElement("th"); c.textContent = x; if (i) c.className = "n"; head.appendChild(c); });
      var dim = data.dims && data.dims[d[0]];
      var rows = (dim && dim.totals) || [];
      var total = 0;
      rows.forEach(function (row) { total += Number(row.n) || 0; });
      rows.forEach(function (row) {
        var tr = t.insertRow();
        var a = tr.insertCell(); a.textContent = row.value;
        var pct = total > 0 ? (Number(row.n) || 0) / total * 100 : 0;
        var bar = document.createElement("span"); bar.className = "bar";
        bar.style.setProperty("--w", pct + "%");
        a.appendChild(bar);
        var b = tr.insertCell(); b.textContent = Math.round(row.n).toLocaleString("en-US"); b.className = "n";
      });
      card.appendChild(t);
      out.appendChild(card);
    });
  }).catch(function () {
    out.textContent = "Statistics are unavailable.";
  });
})();
