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
        "src/core/automation-rules.ts",
        "src/core/document-change.ts",
        "src/core/domain-events.ts",
        "src/core/naming-configuration.ts",
        "src/core/naming.ts",
        "src/core/safe-regex.ts",
        "src/core/predicates.ts",
        "src/core/workflow.ts",
        "src/application/automation-run-consumer.ts",
        "src/application/automation-run-events.ts",
        "src/application/automation-run-policy.ts",
        "src/application/automation-run-service.ts",
        "src/application/document-atomic-commit-policy.ts",
        "src/application/document-command-events.ts",
        "src/application/document-command-policy.ts",
        "src/application/naming-events.ts",
        "src/application/naming-service.ts",
        "src/application/workflow-events.ts",
        "src/application/workflow-policy.ts",
        "src/application/workflow-service.ts",
        "src/adapters/http/naming-api.ts",
        "src/adapters/http/web-form-input.ts",
        "src/application/web-form-policy.ts",
        "src/adapters/desk/client-src/url.ts",
        "src/adapters/desk/client-src/context.ts",
        "src/adapters/desk/client-src/http.ts",
        "src/adapters/desk/client-src/bodies.ts",
        "src/adapters/desk/client-src/topics.ts",
        "src/adapters/desk/client-src/uploads.ts",
        "examples/returns/public-intake.ts"
      ],
      provider: "v8",
      reporter: ["text", "json", "html"],
      thresholds: {
        branches: 93
      }
    },
    environment: "node",
    globals: true,
    testTimeout: 30_000,
    // NOTE: no root-level `include` here — `extends: true` merges (concatenates) arrays,
    // so a root include would leak every test into the desk-client project.
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
          exclude: ["**/node_modules/**", "**/dist/**", "tests/desk-client-src/**"]
        }
      },
      {
        extends: true,
        test: {
          name: "desk-client",
          environment: "happy-dom",
          include: ["tests/desk-client-src/**/*.test.ts"]
        }
      }
    ]
  }
});
