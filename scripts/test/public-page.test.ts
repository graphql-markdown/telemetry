import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const html = read("public/index.html");
const js = read("public/public.js");

const PANELS = ["versions", "ci", "provider", "formatter", "graphql", "loader", "create", "targets", "settings"];

describe("public page static checks", () => {
  it("has CSP meta, no inline script/style, no absolute URLs", () => {
    expect(html).toContain(
      `content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'"`,
    );
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) expect(m[2].trim()).toBe("");
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    for (const text of [html, js]) expect(text).not.toMatch(/https?:\/\//);
  });

  it("references the shared dashboard assets relatively", () => {
    for (const ref of ['href="vendor/uPlot.min.css"', 'href="style.css"', 'href="logo.svg"', 'href="favicon.ico"', 'name="theme-color"']) {
      expect(html).toContain(ref);
    }
    expect(html.indexOf("vendor/uPlot.iife.min.js")).toBeGreaterThan(-1);
    expect(html.indexOf("vendor/uPlot.iife.min.js")).toBeLessThan(html.indexOf('src="public.js"'));
    for (const f of ["public/public.css", "public/logo.svg", "public/vendor"]) expect(existsSync(resolve(root, f))).toBe(false);
  });

  it("has no filter form and exactly the 9 panel sections", () => {
    expect(html).not.toMatch(/<form\b/);
    expect(html).not.toContain('id="controls"');
    const panels = [...html.matchAll(/<section class="panel[^"]*" data-panel="([^"]+)"/g)].map((m) => m[1]);
    expect(panels).toEqual(PANELS);
    for (const p of ["generate", "catalog", "health"]) expect(html).not.toContain(`data-panel="${p}"`);
    expect(html).not.toContain('data-kpi="quarantined"');
    expect(html).toContain('id="updated"');
  });

  it("public.js fetches relative stats.json and avoids innerHTML", () => {
    expect(js).toContain('fetch("stats.json")');
    expect(js.match(/fetch\(/g)).toHaveLength(1);
    expect(js).not.toContain("innerHTML");
  });

  it("asks crawlers and AI agents to stay out", () => {
    const robots = read("public/robots.txt");
    expect(robots).toMatch(/User-agent: \*\nDisallow: \/\n/);
    for (const bot of ["GPTBot", "ClaudeBot", "Google-Extended", "CCBot", "PerplexityBot"]) {
      expect(robots).toContain(`User-agent: ${bot}\nDisallow: /`);
    }
    expect(robots).not.toMatch(/^Allow:/m);
    expect(html).toMatch(/<meta name="robots" content="[^"]*noindex[^"]*nofollow[^"]*">/);
  });

  it("states that n<5 suppression applies to the 90-day total, not to each day", () => {
    expect(html).toContain("The rule applies to the 90-day total of each value");
    expect(html).toContain("not suppressed individually");
  });

  it("CNAME is exact and _headers is absent", () => {
    expect(read("public/CNAME")).toBe("telemetry.graphql-markdown.dev\n");
    expect(existsSync(resolve(root, "public/_headers"))).toBe(false);
  });
});

// ---- fake DOM ----
type El = {
  tag: string;
  _text: string;
  textContent: string;
  className: string;
  title: string;
  children: El[];
  dataset: Record<string, string>;
  style: Record<string, string>;
  listeners: Record<string, (...a: unknown[]) => void>;
  appendChild(c: El): El;
  setAttribute(k: string, v: string): void;
  addEventListener(t: string, f: (...a: unknown[]) => void): void;
  querySelectorAll(sel: string): El[];
};

function makeEl(tag = ""): El {
  const e: El = {
    tag,
    _text: "",
    get textContent() {
      return this._text;
    },
    set textContent(v: string) {
      this._text = v;
      this.children = [];
    },
    className: "",
    title: "",
    children: [],
    dataset: {},
    style: {},
    listeners: {},
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    setAttribute() {},
    addEventListener(t, f) {
      this.listeners[t] = f;
    },
    querySelectorAll(sel) {
      return sel === "section" ? this.children.filter((c) => c.tag === "section") : [];
    },
  } as El;
  return e;
}

const walk = (e: El, out: El[] = []): El[] => {
  out.push(e);
  e.children.forEach((c) => walk(c, out));
  return out;
};
const byClass = (e: El, cls: string) => walk(e).filter((x) => x.className.split(" ").includes(cls));
const byTag = (e: El, tag: string) => walk(e).filter((x) => x.tag === tag);

function sectionsFromHtml(): El[] {
  return [...html.matchAll(/<section class="panel[^"]*"([^>]*)>/g)].map((m) => {
    const s = makeEl("section");
    for (const a of m[1].matchAll(/data-([a-z]+)="([^"]*)"/g)) {
      s.dataset[a[1]] = a[2].replace(/&amp;/g, "&");
    }
    return s;
  });
}

const fixture = {
  version: 2,
  generated: "2026-01-02T03:04:05Z",
  from: "2025-10-05",
  to: "2026-01-02",
  min_count: 5,
  kpis: {
    events: { series: [], totals: [{ value: "a", n: 1000 }, { value: "b", n: 234 }], suppressed_count: 0 },
    configs: { series: [], totals: [], suppressed_count: 3 },
    debounced: { series: [], totals: [{ value: "a", n: 7 }], suppressed_count: 0 },
  },
  panels: {
    versions: {
      series: [
        { day: "2026-01-01", value: "1.0", n: 5 },
        { day: "2026-01-02", value: "1.0", n: 6 },
        { day: "2026-01-02", value: "2.0", n: 9 },
      ],
      totals: [{ value: "1.0", n: 11 }, { value: "2.0", n: 9 }],
      suppressed_count: 1,
    },
    ci: {
      series: [
        { day: "2026-01-01", value: "0", n: 10 },
        { day: "2026-01-01", value: "1", n: 20 },
      ],
      totals: [{ value: "0", n: 10 }, { value: "1", n: 20 }],
      suppressed_count: 0,
    },
    provider: { series: [], totals: [{ value: "github", n: 8 }], suppressed_count: 0 },
    formatter: { series: [], totals: [{ value: "x", n: 750 }, { value: "y", n: 250 }], suppressed_count: 0 },
    graphql: { series: [], totals: [], suppressed_count: 2 },
    loader: { series: [], totals: [], suppressed_count: 0 },
    create: {
      series: [],
      totals: [{ value: "create_scaffold", n: 4 }, { value: "create_wire", n: 6 }, { value: "other", n: 99 }],
      suppressed_count: 0,
    },
    targets: { series: [], totals: [], suppressed_count: 0 },
  },
  settings: [
    { key: "force", totals: [{ value: "true", n: 5 }, { value: "false", n: 7 }], suppressed_count: 1 },
    { key: "pretty", totals: [{ value: "true", n: 30 }], suppressed_count: 0 },
  ],
};

async function runPage(fetchImpl: () => Promise<unknown>, localStorage?: unknown) {
  const sections = sectionsFromHtml();
  const panels = makeEl("div");
  sections.forEach((s) => panels.appendChild(s));
  const names = ["status", "statusDot", "rangeLabel", "updated", "themeButton"];
  const els: Record<string, El> = Object.fromEntries(names.map((n) => [n, makeEl("span")]));
  els.panels = panels;
  const kpis: Record<string, El> = {};
  const foots: Record<string, El> = {};
  for (const k of ["events", "configs", "debounced"]) {
    kpis[k] = makeEl("div");
    foots[k] = makeEl("div");
  }
  const documentElement = { dataset: {} as Record<string, string | undefined> };
  const document = {
    documentElement,
    getElementById: (id: string) => els[id],
    createElement: (t: string) => makeEl(t),
    querySelector: (sel: string) => {
      const m = sel.match(/data-(kpi-foot|kpi)="([a-z]+)"/)!;
      return (m[1] === "kpi" ? kpis : foots)[m[2]];
    },
  };
  const plots: { opts: any; cols: number[][] }[] = [];
  const ctx: any = {
    document,
    fetch: fetchImpl,
    localStorage,
    getComputedStyle: () => ({ getPropertyValue: () => " #123 " }),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout,
    clearTimeout,
    uPlot: class {
      constructor(opts: any, cols: number[][]) {
        plots.push({ opts, cols });
      }
      destroy() {}
      setSize() {}
      static tzDate(d: Date) {
        return d;
      }
    },
    addEventListener() {},
  };
  ctx.window = ctx;
  vm.runInNewContext(js, ctx);
  await new Promise((r) => setTimeout(r, 20));
  return { els, kpis, foots, sections, plots, documentElement };
}

const ok = (data: unknown) => () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
const section = (r: { sections: El[] }, name: string) => r.sections.find((s) => s.dataset.panel === name)!;

describe("public.js behaviour", () => {
  it("fills KPIs, handling suppressed totals", async () => {
    const r = await runPage(ok(fixture));
    expect(r.kpis.events.textContent).toBe("1,234");
    expect(r.kpis.debounced.textContent).toBe("7");
    expect(r.kpis.configs.textContent).toBe("Suppressed");
    expect(r.foots.configs.textContent).toBe("Below the n<5 threshold");
  });

  it("formats the last-updated line and range", async () => {
    const r = await runPage(ok(fixture));
    expect(r.els.updated.textContent).toBe("Last updated 2026-01-02 03:04 UTC (data from 2025-10-05 to 2026-01-02)");
    expect(r.els.rangeLabel.textContent).toBe("Selected range · 5 Oct 2025 – 2 Jan 2026");
    expect(r.els.statusDot.className).toBe("dot ok");
  });

  it("renders share bars with widths and labels", async () => {
    const r = await runPage(ok(fixture));
    const s = section(r, "formatter");
    const bars = byClass(s, "bar");
    expect(bars.map((b) => b.style.width)).toEqual(["100%", "33.33333333333333%"]);
    expect(byClass(s, "label").map((l) => l.textContent)).toEqual(["x", "y"]);
    expect(byTag(s, "summary")[0].textContent).toBe("Data table");
    expect(byClass(section(r, "graphql"), "empty")).toHaveLength(1);
    expect(byClass(section(r, "graphql"), "privacy")[0].textContent).toBe("2 value(s) hidden (n<5)");
  });

  it("limits create to scaffold and wire", async () => {
    const r = await runPage(ok(fixture));
    expect(byClass(section(r, "create"), "label").map((l) => l.textContent)).toEqual(["create_scaffold", "create_wire"]);
  });

  it("ci panel uses local/CI labels", async () => {
    const r = await runPage(ok(fixture));
    const heads = byTag(section(r, "ci"), "th").map((t) => t.textContent);
    expect(heads).toEqual(["Day", "local", "CI"]);
    expect(r.plots.some((p) => p.opts.series.slice(1).map((s: any) => s.label).join() === "local,CI")).toBe(true);
  });

  it("series panel calls uPlot once with the right cols and keeps the table", async () => {
    const r = await runPage(ok(fixture));
    expect(r.plots).toHaveLength(2); // versions + ci
    const p = r.plots[0];
    expect(p.cols).toEqual([
      [Date.parse("2026-01-01T00:00:00Z") / 1000, Date.parse("2026-01-02T00:00:00Z") / 1000],
      [5, 6],
      [0, 9],
    ]);
    const s = section(r, "versions");
    expect(byTag(s, "tr")).toHaveLength(3);
    expect(byTag(s, "td").map((t) => t.textContent)).toEqual(["2026-01-01", "5", "0", "2026-01-02", "6", "9"]);
  });

  it("fills days without rows with zero instead of interpolating across them", async () => {
    const gap = {
      ...fixture,
      panels: {
        ...fixture.panels,
        versions: {
          series: [
            { day: "2026-01-01", value: "a", n: 23 },
            { day: "2026-01-04", value: "a", n: 66 },
          ],
          totals: [{ value: "a", n: 89 }],
          suppressed_count: 0,
        },
      },
    };
    const r = await runPage(ok(gap));
    const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;
    expect(r.plots[0].cols).toEqual([[day("2026-01-01"), day("2026-01-02"), day("2026-01-03"), day("2026-01-04")], [23, 0, 0, 66]]);
    expect(byTag(section(r, "versions"), "td").map((t) => t.textContent)).toEqual([
      "2026-01-01", "23", "2026-01-02", "0", "2026-01-03", "0", "2026-01-04", "66",
    ]);
  });

  it("settings panel sums totals per setting", async () => {
    const r = await runPage(ok(fixture));
    const s = section(r, "settings");
    const labels = byClass(s, "label").map((l) => l.textContent);
    const ns = byClass(s, "n").map((l) => l.textContent);
    expect(labels).toEqual(["pretty", "force"]);
    expect(ns).toEqual(["30", "12"]);
    expect(byClass(s, "privacy")[0].textContent).toBe("1 value(s) hidden (n<5)");
  });

  it("shows unavailable on fetch rejection", async () => {
    const r = await runPage(() => Promise.reject(new Error("net")));
    expect(r.els.panels.textContent).toBe("Statistics are unavailable.");
    expect(r.els.statusDot.className).toBe("dot error");
  });

  it("shows unavailable on non-OK status", async () => {
    const r = await runPage(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }));
    expect(r.els.panels.textContent).toBe("Statistics are unavailable.");
  });

  it("theme toggle works and survives a throwing localStorage", async () => {
    const boom = () => {
      throw new Error("blocked");
    };
    const r = await runPage(ok(fixture), { getItem: boom, setItem: boom });
    expect(() => r.els.themeButton.listeners.click()).not.toThrow();
    expect(r.documentElement.dataset.theme).toBe("dark");
    r.els.themeButton.listeners.click();
    expect(r.documentElement.dataset.theme).toBe("light");
  });
});

describe("build-public.sh", () => {
  it("assembles a self-contained site", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "pub-"));
    try {
      const rows = [
        { day: "2026-01-01", ci: "0", dim: "event", measure: "raw", value: "generate", n: 50 },
        { day: "2026-01-01", ci: "0", dim: "event", measure: "debounced_1d", value: "generate", n: 40 },
        { day: "2026-01-01", ci: "0", dim: "pkgVersion", measure: "raw", value: "1.0.0", n: 50 },
        { day: "2026-01-01", ci: "1", dim: "ci", measure: "raw", value: "1", n: 30 },
      ];
      const fixtureFile = resolve(dir, "d1.json");
      writeFileSync(fixtureFile, JSON.stringify([{ results: rows, success: true }]));
      const out = resolve(dir, "site");
      const res = spawnSync(resolve(root, "scripts/build-public.sh"), [out], {
        env: { ...process.env, D1_JSON_FILE: fixtureFile },
        encoding: "utf8",
      });
      expect(res.stderr).toBe("");
      expect(res.status).toBe(0);
      const built = (p: string) => resolve(out, p);
      const page = readFileSync(built("index.html"), "utf8");
      const refs = [...page.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
      expect(refs.length).toBeGreaterThan(5);
      for (const ref of refs) expect(existsSync(built(ref)), ref).toBe(true);
      const cssText = readFileSync(built("style.css"), "utf8");
      const urls = [...cssText.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]);
      expect(urls.length).toBeGreaterThan(0);
      for (const u of urls) expect(existsSync(resolve(dirname(built("style.css")), u)), u).toBe(true);
      expect(JSON.parse(readFileSync(built("stats.json"), "utf8")).version).toBe(2);
      expect(existsSync(built(".nojekyll"))).toBe(true);
      expect(existsSync(built("CNAME"))).toBe(true);
      expect(existsSync(built("public.js"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
