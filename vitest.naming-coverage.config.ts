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
        "src/core/naming.ts",
        "src/core/naming-configuration.ts",
        "src/core/safe-regex.ts",
        "src/application/naming-events.ts",
        "src/application/naming-service.ts",
        "src/application/metadata-revision.ts",
        "src/application/custom-field-service.ts",
        "src/application/field-property-service.ts",
        "src/application/document-naming.ts",
        "src/application/document-service.ts",
        "src/application/document-atomic-commit-policy.ts",
        "src/adapters/d1/document-store.ts",
        "src/cloudflare/durable-object-command-executor.ts",
        "src/adapters/http/naming-api.ts",
        "src/adapters/http/web-form-input.ts",
        "src/application/web-form-policy.ts"
      ],
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "coverage/naming",
      thresholds: {
        branches: 93,
        perFile: true
      }
    },
    environment: "node",
    globals: true,
    include: [
      "tests/core/naming.test.ts",
      "tests/core/safe-regex.test.ts",
      "tests/application/naming-service.test.ts",
      "tests/application/metadata-revision.test.ts",
      "tests/application/custom-field-service.test.ts",
      "tests/application/field-property-service.test.ts",
      "tests/application/document-naming.test.ts",
      "tests/application/document-service.test.ts",
      "tests/application/web-form-policy.test.ts",
      "tests/adapters/d1-document-store.test.ts",
      "tests/cloudflare/durable-object-command-executor.test.ts",
      "tests/http/naming-api.test.ts",
      "tests/http/web-form-input.test.ts",
      "tests/http/web-form-api.test.ts"
    ]
  }
});
