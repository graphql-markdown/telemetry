(function () {
  var DIMS = [["formatter", "Formatter"], ["graphqlMajor", "GraphQL major"], ["loader.kind", "Loader kinds"], ["pkgVersion", "Versions"]];
  var out = document.getElementById("out");
  DIMS.forEach(function (d) {
    fetch("/public/v1/stats?dim=" + encodeURIComponent(d[0])).then(function (r) { return r.json(); }).then(function (data) {
      var h = document.createElement("h2"); h.textContent = d[1]; out.appendChild(h);
      var t = document.createElement("table");
      var head = t.insertRow();
      ["Value", "Events (90 days)"].forEach(function (x, i) { var c = document.createElement("th"); c.textContent = x; if (i) c.className = "n"; head.appendChild(c); });
      (data.totals || []).forEach(function (row) {
        var tr = t.insertRow();
        var a = tr.insertCell(); a.textContent = row.value;
        var b = tr.insertCell(); b.textContent = Math.round(row.n).toLocaleString("en-US"); b.className = "n";
      });
      out.appendChild(t);
    });
  });
})();
