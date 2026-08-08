import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": new URL("./tests/stubs/cloudflare-workers.ts", import.meta.url).pathname
    }
  },
  test: {
    coverage: {
      all: true,
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/cli.ts", "src/cloudflare/index.ts"],
      provider: "v8",
      reporter: ["text", "json", "html"]
    },
    environment: "node",
    globals: true,
    testTimeout: 30_000,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]
  }
});
