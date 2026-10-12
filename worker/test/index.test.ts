import { describe, expect, it } from "vitest";

import worker from "../src/index";

describe("worker skeleton", () => {
  it("returns 404 for unknown routes", async () => {
    const res = await worker.fetch(new Request("https://example.com/"));
    expect(res.status).toBe(404);
  });

  it("returns 501 for POST /v1/event", async () => {
    const res = await worker.fetch(
      new Request("https://example.com/v1/event", { method: "POST" }),
    );
    expect(res.status).toBe(501);
  });
});
