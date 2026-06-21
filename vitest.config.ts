import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": new URL("./tests/stubs/cloudflare-workers.ts", import.meta.url).pathname
    }
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"]
  }
});
