import { readFileSync } from "node:fs";
import { defineDocumentHooks } from "../../src";

describe("document hooks", () => {
  it("snapshots hook entries by value", () => {
    const beforeValidate = vi.fn();
    const replacementBeforeValidate = vi.fn();
    const hooks = { beforeValidate };

    const snapshot = defineDocumentHooks(hooks);
    hooks.beforeValidate = replacementBeforeValidate;

    expect(snapshot.beforeValidate).toBe(beforeValidate);
    expect(snapshot.beforeValidate).not.toBe(replacementBeforeValidate);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("keeps application hook contracts independent from registry internals", () => {
    const applicationSources = [
      "src/application/assignment-rule-service.ts",
      "src/application/document-service.ts",
      "src/application/realtime.ts"
    ].map((file) => readFileSync(file, "utf8"));

    const source = applicationSources.join("\n");

    expect(source).not.toMatch(/import type \{[^}]*AfterCommitContext[^}]*\} from "\.\.\/core\/registry\.js";/);
    expect(source).not.toMatch(/import type \{[^}]*DocumentHooks[^}]*\} from "\.\.\/core\/registry\.js";/);
    expect(source).toContain('from "../core/document-hooks.js"');
  });
});
