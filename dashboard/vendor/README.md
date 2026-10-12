# Vendored dependencies

Self-hosted so the dashboard can run under a strict CSP (`script-src 'self'`, `style-src 'self'`) with no third-party requests. Subresource Integrity is unnecessary because the files are served from the same origin.

| File | Package | Version | Source URL | SHA-256 |
| --- | --- | --- | --- | --- |
| `uPlot.iife.min.js` | uplot | 1.6.31 | https://cdn.jsdelivr.net/npm/uplot@1.6.31/dist/uPlot.iife.min.js | `2d27e8ad3d228164525ce213f9dc716f39b4e3aee0cc773fb3491c96cf4921a2` |
| `uPlot.min.css` | uplot | 1.6.31 | https://cdn.jsdelivr.net/npm/uplot@1.6.31/dist/uPlot.min.css | `df630c6a8d6f8eeaff264b50f73ce5b114f646ffd9a0bb74f049b0a00135fa04` |

To upgrade: download the new files, update this table, and update the `dashboard/index.html` references.
