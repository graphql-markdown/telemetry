import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const html = read("public/index.html");
const js = read("public/public.js");

describe("public page static checks", () => {
  it("has CSP meta, no inline script, no absolute URLs", () => {
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      expect(m[2].trim()).toBe("");
    }
    expect(html).not.toMatch(/https?:\/\//);
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
  appendChild(c: El): El;
  insertRow(): El;
  insertCell(): El;
};

function makeEl(tag = ""): El {
  const el: El = {
    tag,
    textContent: "",
    className: "",
    children: [],
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
  };
  return el;
}

async function runPage(fetchImpl: () => Promise<unknown>) {
  const out = makeEl("div");
  const updated = makeEl("small");
  const document = {
    getElementById: (id: string) => (id === "out" ? out : updated),
    createElement: (t: string) => makeEl(t),
  };
  vm.runInNewContext(js, { document, fetch: fetchImpl });
  await new Promise((r) => setTimeout(r, 20));
  return { out, updated };
}

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
    expect(updated.textContent).toContain("2026-01-02");
    const table = out.children.find((c) => c.tag === "table")!;
    const row = table.children[1];
    expect(row.children[0].textContent).toBe("Value");
    expect(row.children[1].textContent).toBe("1,234");
    expect(out.children.filter((c) => c.tag === "table")).toHaveLength(4);
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
