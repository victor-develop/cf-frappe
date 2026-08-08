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
    // NOTE: no root-level `include` here — `extends: true` merges (concatenates) arrays,
    // so a root include would leak every test into the desk-client project.
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
          exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "tests/desk-client-src/**",
            "tests/desk-islands/**"
          ]
        }
      },
      {
        extends: true,
        test: {
          name: "desk-client",
          environment: "happy-dom",
          include: ["tests/desk-client-src/**/*.test.ts"]
        }
      },
      {
        extends: true,
        test: {
          name: "desk-islands",
          environment: "happy-dom",
          include: ["tests/desk-islands/**/*.test.ts", "tests/desk-islands/**/*.test.tsx"]
        }
      }
    ]
  }
});
