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
      include: [
        "src/application/automation-run-consumer.ts",
        "src/application/automation-run-events.ts",
        "src/application/automation-run-policy.ts",
        "src/application/automation-run-service.ts",
        "src/application/assigned-documents-policy.ts",
        "src/application/document-history-service.ts",
        "src/core/automation-rules.ts"
      ],
      provider: "v8",
      reporter: ["text", "json", "html"],
      thresholds: {
        branches: 93
      }
    },
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"]
  }
});
