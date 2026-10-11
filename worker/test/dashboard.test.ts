import { describe, expect, it } from "vitest";

import app from "../../dashboard/app.js?raw";
import html from "../../dashboard/index.html?raw";

describe("dashboard assets", () => {
  it("pins an exact uPlot version", () => {
    const versions = [...html.matchAll(/uplot@(\d+\.\d+\.\d+)\//g)].map((m) => m[1]);
    expect(versions.length).toBeGreaterThan(0);
    expect(new Set(versions).size).toBe(1);
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
