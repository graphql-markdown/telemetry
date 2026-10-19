# Vendored dependencies

Self-hosted so the dashboard can run under a strict CSP (`script-src 'self'`, `style-src 'self'`) with no third-party requests. Subresource Integrity is unnecessary because the files are served from the same origin.

| File | Package | Version | Source URL | SHA-256 |
| --- | --- | --- | --- | --- |
| `uPlot.iife.min.js` | uplot | 1.6.31 | https://cdn.jsdelivr.net/npm/uplot@1.6.31/dist/uPlot.iife.min.js | `2d27e8ad3d228164525ce213f9dc716f39b4e3aee0cc773fb3491c96cf4921a2` |
| `uPlot.min.css` | uplot | 1.6.31 | https://cdn.jsdelivr.net/npm/uplot@1.6.31/dist/uPlot.min.css | `df630c6a8d6f8eeaff264b50f73ce5b114f646ffd9a0bb74f049b0a00135fa04` |
| `jost-latin-wght-normal.woff2` | @fontsource-variable/jost | 5.3.0 | https://cdn.jsdelivr.net/npm/@fontsource-variable/jost@5.3.0/files/jost-latin-wght-normal.woff2 | `7726a5cd6f3c0e876c028ea2a643d45f7aad4b0f164b70966c669f4a4668f4b9` |
| `victor-mono-latin-wght-normal.woff2` | @fontsource-variable/victor-mono | 5.3.0 | https://cdn.jsdelivr.net/npm/@fontsource-variable/victor-mono@5.3.0/files/victor-mono-latin-wght-normal.woff2 | `a3bf150f107ecf305583fc09f629f1b9e94268e07cb66c2718385be6b5215f57` |

The fonts are the GraphQL-Markdown website fonts (Latin subset, variable weight), licensed under the SIL Open Font License 1.1: see `OFL-Jost.txt` and `OFL-VictorMono.txt`. They are declared with `@font-face` in `../style.css`.

To upgrade: download the new files, update this table, and update the `dashboard/index.html` (uPlot) or `dashboard/style.css` (fonts) references.
