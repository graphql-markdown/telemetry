import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const html = read("public/index.html");
const js = read("public/public.js");
const css = read("public/public.css");

describe("public page static checks", () => {
  it("has CSP meta, no inline script, no absolute URLs", () => {
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      expect(m[2].trim()).toBe("");
    }
    for (const text of [html, js, css]) expect(text).not.toMatch(/https?:\/\//);
  });

  it("public.css has no @import or remote url() and every url() exists", () => {
    expect(css).not.toMatch(/url\(\s*["']?http/);
    expect(css).not.toContain("@import");
    const urls = [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(existsSync(resolve(root, "public", u))).toBe(true);
  });

  it("logo background is white, not the old green", () => {
    expect(css.toLowerCase()).not.toContain("dbf5e6");
    expect(css).toMatch(/\.logo \{[^}]*background: #fff;/);
  });

  it("ships logo and licences", () => {
    for (const f of ["logo.svg", "vendor/OFL-Jost.txt", "vendor/OFL-VictorMono.txt"]) {
      expect(existsSync(resolve(root, "public", f))).toBe(true);
    }
    expect(html).toContain('href="logo.svg"');
    expect(html).toContain('name="theme-color"');
    expect(html).not.toMatch(/\sstyle=/);
  });

  it("references assets relatively", () => {
    expect(html).toContain('src="public.js"');
    expect(html).toContain('href="public.css"');
    expect(html).toContain('href="favicon.ico"');
  });

  it("public.js fetches relative stats.json and avoids innerHTML", () => {
    expect(js).toContain('fetch("stats.json")');
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

  it("CNAME is exact and _headers is absent", () => {
    expect(read("public/CNAME")).toBe("telemetry.graphql-markdown.dev\n");
    expect(existsSync(resolve(root, "public/_headers"))).toBe(false);
  });
});

type El = {
  tag?: string;
  textContent: string;
  className: string;
  children: El[];
  style: { props: Record<string, string>; setProperty(k: string, v: string): void };
  listeners: Record<string, () => void>;
  appendChild(c: El): El;
  insertRow(): El;
  insertCell(): El;
  addEventListener(t: string, f: () => void): void;
};

function makeEl(tag = ""): El {
  const el: El = {
    tag,
    textContent: "",
    className: "",
    children: [],
    style: {
      props: {},
      setProperty(k, v) {
        this.props[k] = v;
      },
    },
    listeners: {},
    appendChild(c) {
      el.children.push(c);
      return c;
    },
    insertRow() {
      return el.appendChild(makeEl("tr"));
    },
    insertCell() {
      return el.appendChild(makeEl("td"));
    },
    addEventListener(t, f) {
      el.listeners[t] = f;
    },
  };
  return el;
}

async function runPage(fetchImpl: () => Promise<unknown>, localStorage?: unknown) {
  const out = makeEl("div");
  const updated = makeEl("small");
  const button = makeEl("button");
  const documentElement = { dataset: {} as Record<string, string | undefined> };
  const document = {
    documentElement,
    getElementById: (id: string) => (id === "out" ? out : id === "themeButton" ? button : updated),
    createElement: (t: string) => makeEl(t),
  };
  vm.runInNewContext(js, { document, fetch: fetchImpl, localStorage });
  await new Promise((r) => setTimeout(r, 20));
  return { out, updated, button, documentElement };
}

const cards = (out: El) => out.children.filter((c) => c.tag === "section");

describe("public.js behaviour", () => {
  const ok = (data: unknown) => () =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });

  it("renders rows", async () => {
    const data = {
      generated: "2026-01-02T03:04:05Z",
      from: "2025-10-05",
      to: "2026-01-02",
      dims: { formatter: { totals: [{ value: "Value", n: 1234 }], suppressed_count: 0 } },
    };
    const { out, updated } = await runPage(ok(data));
    expect(updated.textContent).toContain("Last updated 2026-01-02 03:04 UTC (data from 2025-10-05 to 2026-01-02)");
    expect(cards(out)).toHaveLength(4);
    const table = cards(out)[0].children.find((c) => c.tag === "table")!;
    const row = table.children[1];
    expect(row.children[0].textContent).toBe("Value");
    expect(row.children[1].textContent).toBe("1,234");
  });

  it("sets the bar width to the row share", async () => {
    const data = {
      generated: "2026-01-02T03:04:05Z",
      from: "a",
      to: "b",
      dims: { formatter: { totals: [{ value: "x", n: 750 }, { value: "y", n: 250 }] } },
    };
    const { out } = await runPage(ok(data));
    const table = cards(out)[0].children.find((c) => c.tag === "table")!;
    const bar = table.children[1].children[0].children.find((c) => c.className === "bar")!;
    expect(bar.style.props["--w"]).toBe("75%");
  });

  it("does not produce NaN for a zero-total dimension", async () => {
    const data = {
      generated: "2026-01-02T03:04:05Z",
      from: "a",
      to: "b",
      dims: { formatter: { totals: [{ value: "x", n: 0 }] } },
    };
    const { out } = await runPage(ok(data));
    const table = cards(out)[0].children.find((c) => c.tag === "table")!;
    const bar = table.children[1].children[0].children.find((c) => c.className === "bar")!;
    expect(bar.style.props["--w"]).toBe("0%");
  });

  it("cycles theme system -> light -> dark and persists it", async () => {
    const store: Record<string, string> = {};
    const ls = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
      removeItem: (k: string) => void delete store[k],
    };
    const { button, documentElement } = await runPage(() => Promise.reject(new Error("x")), ls);
    expect(documentElement.dataset.theme).toBeUndefined();
    button.listeners.click();
    expect(documentElement.dataset.theme).toBe("light");
    button.listeners.click();
    expect(documentElement.dataset.theme).toBe("dark");
    expect(Object.values(store)).toEqual(["dark"]);
    button.listeners.click();
    expect(documentElement.dataset.theme).toBeUndefined();
    expect(Object.keys(store)).toHaveLength(0);
  });

  it("theme toggle survives a throwing localStorage", async () => {
    const boom = () => {
      throw new Error("blocked");
    };
    const ls = { getItem: boom, setItem: boom, removeItem: boom };
    const { button, documentElement } = await runPage(() => Promise.reject(new Error("x")), ls);
    expect(() => button.listeners.click()).not.toThrow();
    expect(documentElement.dataset.theme).toBe("light");
  });

  it("shows unavailable on fetch rejection", async () => {
    const { out } = await runPage(() => Promise.reject(new Error("net")));
    expect(out.textContent).toBe("Statistics are unavailable.");
  });

  it("shows unavailable on non-OK status", async () => {
    const { out } = await runPage(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }));
    expect(out.textContent).toBe("Statistics are unavailable.");
  });
});
