import { readFileSync } from "node:fs";
import {
  defineDocType,
  defineDocumentHooks,
  documentHookContext,
  documentValidationHookData,
  mergeDocumentHookPatch,
  type DocumentSnapshot
} from "../../src";

const Note = defineDocType({
  name: "Note",
  fields: [{ name: "title", type: "text" }]
});

const existing: DocumentSnapshot = {
  tenantId: "acme",
  doctype: "Note",
  name: "NOTE-1",
  version: 2,
  docstatus: "draft",
  data: { title: "Old", body: "Existing" },
  createdAt: "2026-06-28T01:00:00.000Z",
  updatedAt: "2026-06-28T01:30:00.000Z"
};

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

  it("builds compact document hook contexts with optional existing snapshots", () => {
    expect(documentHookContext({ doctype: Note, data: { title: "Draft", body: undefined } })).toEqual({
      doctype: Note,
      data: { title: "Draft" }
    });

    expect(documentHookContext({ doctype: Note, data: { title: "Draft" }, existing })).toEqual({
      doctype: Note,
      data: { title: "Draft" },
      existing
    });
  });

  it("merges beforeValidate patches without forcing service orchestration to know patch rules", () => {
    expect(mergeDocumentHookPatch({ title: "Draft", body: "A" }, undefined)).toEqual({
      title: "Draft",
      body: "A"
    });
    expect(mergeDocumentHookPatch({ title: "Draft", body: "A" }, { body: undefined, status: "Open" })).toEqual({
      title: "Draft",
      body: undefined,
      status: "Open"
    });
  });

  it("plans validation hook data from override, create data, or existing document data", () => {
    expect(documentValidationHookData({ data: { title: "New", body: undefined } })).toEqual({
      title: "New"
    });
    expect(documentValidationHookData({ data: { title: "New" }, existing })).toEqual({
      title: "New",
      body: "Existing"
    });
    expect(documentValidationHookData({ data: { title: "New" }, existing, override: { title: "Override" } })).toEqual({
      title: "Override"
    });
  });
});
