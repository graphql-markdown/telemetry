import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const app = readFileSync(resolve(__dirname, "../../dashboard/app.js"), "utf8");

// dashboard/app.js is one IIFE tied to the DOM, so pull the two pure helpers out of the source.
const grab = (name: string): string => {
  const m = new RegExp(`^  function ${name}\\b[\\s\\S]*?^  }$|^  function ${name}\\b.*\\}$`, "m").exec(app);
  if (!m) throw new Error(`function ${name} not found in dashboard/app.js`);
  return m[0];
};
const fillDays = runInNewContext(`${grab("iso")}\n${grab("fillDays")}\nfillDays`) as (days: string[]) => string[];

describe("dashboard time series days", () => {
  it("fills days without rows so the line is not interpolated across them", () => {
    expect(fillDays(["2026-10-13", "2026-10-15", "2026-10-19"])).toEqual([
      "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19",
    ]);
  });

  it("keeps consecutive days and a single day as they are", () => {
    expect(fillDays(["2026-10-13", "2026-10-14"])).toEqual(["2026-10-13", "2026-10-14"]);
    expect(fillDays(["2026-10-13"])).toEqual(["2026-10-13"]);
  });

  it("returns nothing for no data", () => {
    expect(fillDays([])).toEqual([]);
  });

  it("crosses month and year boundaries in UTC", () => {
    expect(fillDays(["2026-12-30", "2027-01-02"])).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });

  it("renderSeries builds its x-axis from the filled days", () => {
    expect(app).toMatch(/var days = fillDays\(/);
  });
});
