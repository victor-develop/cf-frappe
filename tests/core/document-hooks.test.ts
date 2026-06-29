import { readFileSync } from "node:fs";
import {
  defineDocType,
  defineDocumentHooks,
  documentAfterCommitContext,
  documentHookContext,
  documentValidationHookData,
  mergeDocumentHookPatch,
  runDocumentAfterCommitHooks,
  runDocumentBeforeValidateHooks,
  runDocumentValidationHooks,
  type DomainEvent,
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

  it("runs beforeValidate hooks as an ordered patch fold over compact data", async () => {
    await expect(runDocumentBeforeValidateHooks({
      doctype: Note,
      data: { title: "Draft" },
      hooks: [
        {
          beforeValidate: (context) => ({
            body: `${context.data.title} body`,
            ignored: undefined
          })
        },
        {
          beforeValidate: (context) => ({
            title: `${context.data.title} refined`,
            extra: context.existing?.name
          })
        }
      ],
      existing
    })).resolves.toEqual({
      title: "Draft refined",
      body: "Draft body",
      extra: "NOTE-1"
    });
  });

  it("collects validation issues from hooks using merged existing data", async () => {
    await expect(runDocumentValidationHooks({
      doctype: Note,
      data: { title: "New" },
      hooks: [
        {
          validate: (context) => context.data.body === "Existing"
            ? [{ field: "body", code: "body_existing", message: "Body came from existing data" }]
            : []
        },
        {
          validate: (context) => [{ field: "title", code: "title_seen", message: String(context.data.title) }]
        }
      ],
      existing
    })).resolves.toEqual([
      { field: "body", code: "body_existing", message: "Body came from existing data" },
      { field: "title", code: "title_seen", message: "New" }
    ]);
  });

  it("collects validation issues from hook data overrides without merging existing data", async () => {
    await expect(runDocumentValidationHooks({
      doctype: Note,
      data: { title: "New" },
      hookDataOverride: { title: "Override" },
      hooks: [{
        validate: (context) => [
          { field: "title", code: "title_seen", message: String(context.data.title) },
          { field: "body", code: "body_missing", message: String(context.data.body) }
        ]
      }],
      existing
    })).resolves.toEqual([
      { field: "title", code: "title_seen", message: "Override" },
      { field: "body", code: "body_missing", message: "undefined" }
    ]);
  });

  it("builds afterCommit contexts from committed snapshots", () => {
    expect(documentAfterCommitContext({ doctype: Note, event, snapshot: existing })).toEqual({
      doctype: Note,
      data: existing.data,
      event,
      snapshot: existing
    });
  });

  it("builds afterCommit contexts for events without a current snapshot", () => {
    expect(documentAfterCommitContext({ doctype: Note, event, snapshot: null })).toEqual({
      doctype: Note,
      data: {},
      event,
      snapshot: null
    });
  });

  it("runs document afterCommit hooks before the service-level afterCommit hook", async () => {
    const calls: string[] = [];

    await runDocumentAfterCommitHooks({
      doctype: Note,
      event,
      snapshot: existing,
      hooks: [
        { afterCommit: (context) => { calls.push(`first:${context.data.title}`); } },
        { afterCommit: (context) => { calls.push(`second:${context.event.id}`); } }
      ],
      afterCommit: (context) => {
        calls.push(`global:${context.snapshot?.name}`);
      }
    });

    expect(calls).toEqual(["first:Old", "second:evt_1", "global:NOTE-1"]);
  });

  it("routes afterCommit hook errors and continues running later hooks", async () => {
    const calls: string[] = [];
    const firstError = new Error("first hook failed");
    const globalError = new Error("global hook failed");

    await runDocumentAfterCommitHooks({
      doctype: Note,
      event,
      snapshot: existing,
      hooks: [
        {
          afterCommit: () => {
            calls.push("first");
            throw firstError;
          }
        },
        { afterCommit: () => { calls.push("second"); } }
      ],
      afterCommit: () => {
        calls.push("global");
        throw globalError;
      },
      onHookError: (error, failedEvent) => {
        calls.push(`error:${(error as Error).message}:${failedEvent.id}`);
      }
    });

    expect(calls).toEqual([
      "first",
      "error:first hook failed:evt_1",
      "second",
      "global",
      "error:global hook failed:evt_1"
    ]);
  });

  it("propagates afterCommit error handler failures", async () => {
    await expect(runDocumentAfterCommitHooks({
      doctype: Note,
      event,
      snapshot: existing,
      hooks: [{
        afterCommit: () => {
          throw new Error("hook failed");
        }
      }],
      onHookError: () => {
        throw new Error("handler failed");
      }
    })).rejects.toThrow("handler failed");
  });
});

const event: DomainEvent = {
  id: "evt_1",
  tenantId: "acme",
  stream: "acme:Note:NOTE-1",
  sequence: 3,
  type: "NoteUpdated",
  doctype: "Note",
  documentName: "NOTE-1",
  actorId: "user@example.com",
  occurredAt: "2026-06-28T02:00:00.000Z",
  payload: { kind: "DocumentUpdated", patch: { title: "New" } },
  metadata: {}
};
