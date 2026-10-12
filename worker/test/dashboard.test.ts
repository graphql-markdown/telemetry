import { describe, expect, it } from "vitest";

import app from "../../dashboard/app.js?raw";
import html from "../../dashboard/index.html?raw";
import publicHtml from "../../dashboard/public.html?raw";
import vendorReadme from "../../dashboard/vendor/README.md?raw";

describe("dashboard assets", () => {
  it("self-hosts uPlot at a pinned version, with no external URLs", () => {
    expect(vendorReadme).toContain("1.6.31");
    expect(html).toContain('src="vendor/uPlot.iife.min.js"');
    expect(html).toContain('href="vendor/uPlot.min.css"');
    for (const page of [html, publicHtml, app]) {
      expect(page).not.toMatch(/https?:\/\//);
    }
  });

  it("loads no https script src in index.html", () => {
    expect([...html.matchAll(/<script[^>]*\ssrc="(https?:[^"]*)"/g)]).toEqual([]);
  });

  it("states the accepted biases and the suppression rule", () => {
    expect(html).toContain("n&lt;5 suppressed");
    expect(html).toContain("Accepted biases");
  });

  it("has the toggles, range picker and every panel", () => {
    for (const needle of ['id="from"', 'id="to"', 'value="events"', 'value="debounced"', 'value="configs"', 'value="local"', 'value="ci"', 'value="all"']) {
      expect(html).toContain(needle);
    }
    for (const panel of ["versions", "ci", "provider", "formatter", "graphql", "loader", "create", "settings", "catalog", "health"]) {
      expect(html).toContain(`data-panel="${panel}"`);
    }
  });

  it("declares light and dark color schemes", () => {
    expect(html).toContain('name="color-scheme" content="light dark"');
  });

  it("renders data without innerHTML and defaults to the local view", () => {
    expect(app).not.toContain("innerHTML");
    expect(html).toMatch(/value="local" checked/);
  });
});
