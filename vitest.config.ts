import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./worker/wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["worker/test/**/*.test.ts"],
    // Vitest blanks CSS imports by default; dashboard.test.ts reads style.css raw.
    css: { include: [/dashboard\/style\.css/] },
  },
});
