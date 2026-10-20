(function () {
  var DIMS = [["formatter", "Formatter"], ["graphqlMajor", "GraphQL major"], ["loader.kind", "Loader kinds"], ["pkgVersion", "Versions"]];
  var out = document.getElementById("out");
  var updated = document.getElementById("updated");
  fetch("stats.json").then(function (r) {
    if (!r.ok) { throw new Error("HTTP " + r.status); }
    return r.json();
  }).then(function (data) {
    updated.textContent = "Last updated " + data.generated.slice(0, 16).replace("T", " ") + " UTC (data from " + data.from + " to " + data.to + ")";
    DIMS.forEach(function (d) {
      var h = document.createElement("h2"); h.textContent = d[1]; out.appendChild(h);
      var t = document.createElement("table");
      var head = t.insertRow();
      ["Value", "Events (90 days)"].forEach(function (x, i) { var c = document.createElement("th"); c.textContent = x; if (i) c.className = "n"; head.appendChild(c); });
      var dim = data.dims && data.dims[d[0]];
      ((dim && dim.totals) || []).forEach(function (row) {
        var tr = t.insertRow();
        var a = tr.insertCell(); a.textContent = row.value;
        var b = tr.insertCell(); b.textContent = Math.round(row.n).toLocaleString("en-US"); b.className = "n";
      });
      out.appendChild(t);
    });
  }).catch(function () {
    out.textContent = "Statistics are unavailable.";
  });
})();
