import { describe, expect, it } from "vitest";

import {
  defineDocType,
  deterministicIds,
  ensureCreateNameAllowed,
  namingSeriesEventCommand,
  namingSeriesCurrentValue,
  planNamingSeriesEvent,
  renderNamingSeries,
  resolveDocumentName,
  type DocumentSnapshot
} from "../../src";

describe("document naming", () => {
  it("resolves uuid names through the configured id generator", () => {
    const Note = defineDocType({
      name: "Note",
      fields: [{ name: "title", type: "text" }]
    });

    expect(resolveDocumentName(Note, { title: "Hello" }, deterministicIds(["note-1"]))).toBe("doc_note-1");
  });

  it("resolves field-backed names from document data", () => {
    const Project = defineDocType({
      name: "Project",
      naming: { kind: "field", field: "title" },
      fields: [{ name: "title", type: "text" }]
    });

    expect(resolveDocumentName(Project, { title: "Apollo" }, deterministicIds(["unused"]))).toBe("Apollo");
    expect(() => resolveDocumentName(Project, { title: "" }, deterministicIds(["unused"]))).toThrow(
      "Validation failed"
    );
  });

  it("resolves provided names from the configured field or id fallback", () => {
    const Account = defineDocType({
      name: "Account",
      naming: { kind: "provided", field: "account_id" },
      fields: [{ name: "account_id", type: "text" }]
    });

    expect(resolveDocumentName(Account, { account_id: "acct_1" }, deterministicIds(["unused"]))).toBe("acct_1");
    expect(resolveDocumentName(Account, {}, deterministicIds(["acct_2"]))).toBe("doc_acct_2");
  });

  it("keeps series allocation on the document-store backed path", () => {
    const Ticket = defineDocType({
      name: "Ticket",
      naming: { kind: "series", pattern: "TICK-.####" },
      fields: [{ name: "subject", type: "text" }]
    });

    expect(() => resolveDocumentName(Ticket, { subject: "First" }, deterministicIds(["unused"]))).toThrow(
      "Naming series for Ticket needs a document store"
    );
    expect(() => ensureCreateNameAllowed(Ticket, "TICK-.0001")).toThrow("Validation failed");
    expect(() => ensureCreateNameAllowed(Ticket, undefined)).not.toThrow();
  });

  it("renders naming series placeholders and reads current series values", () => {
    expect(renderNamingSeries("TICK-.####", 42)).toBe("TICK-.0042");
    expect(renderNamingSeries("TASK-##-FY26", 7)).toBe("TASK-07-FY26");
    expect(namingSeriesCurrentValue(3)).toBe(3);
    expect(namingSeriesCurrentValue(-1)).toBeUndefined();
    expect(namingSeriesCurrentValue(1.5)).toBeUndefined();
    expect(namingSeriesCurrentValue("3")).toBeUndefined();
  });

  it("plans naming series start events", () => {
    expect(
      planNamingSeriesEvent({
        doctypeName: "Ticket",
        pattern: "TICK-.####",
        next: 1,
        existing: null
      })
    ).toEqual({
      eventType: "NamingSeriesStarted",
      documentName: "Ticket:TICK-.####",
      payload: {
        kind: "DocumentCreated",
        data: { doctype: "Ticket", pattern: "TICK-.####", current: 1 },
        docstatus: "draft"
      },
      metadata: { target_doctype: "Ticket" }
    });
  });

  it("plans naming series advance events", () => {
    expect(
      planNamingSeriesEvent({
        doctypeName: "Ticket",
        pattern: "TICK-.####",
        next: 2,
        existing: namingSeriesSnapshot(1)
      })
    ).toEqual({
      eventType: "NamingSeriesAdvanced",
      documentName: "Ticket:TICK-.####",
      payload: { kind: "DocumentUpdated", patch: { current: 2 } },
      metadata: { target_doctype: "Ticket" }
    });
  });

  it("shapes naming series start event commands from event plans", () => {
    const plan = planNamingSeriesEvent({
      doctypeName: "Ticket",
      pattern: "TICK-.####",
      next: 1,
      existing: null
    });

    expect(
      namingSeriesEventCommand({
        tenantId: "acme",
        stream: "acme:__NamingSeries:Ticket%3ATICK-%2E%23%23%23%23",
        actorId: "user@example.com",
        occurredAt: "2026-06-28T02:00:00.000Z",
        plan
      })
    ).toEqual({
      tenantId: "acme",
      stream: "acme:__NamingSeries:Ticket%3ATICK-%2E%23%23%23%23",
      type: "NamingSeriesStarted",
      doctype: "__NamingSeries",
      documentName: "Ticket:TICK-.####",
      actorId: "user@example.com",
      occurredAt: "2026-06-28T02:00:00.000Z",
      payload: plan.payload,
      metadata: { target_doctype: "Ticket" }
    });
  });

  it("shapes naming series advance event commands from event plans", () => {
    const plan = planNamingSeriesEvent({
      doctypeName: "Ticket",
      pattern: "TICK-.####",
      next: 2,
      existing: namingSeriesSnapshot(1)
    });

    expect(
      namingSeriesEventCommand({
        tenantId: "acme",
        stream: "acme:__NamingSeries:Ticket%3ATICK-%2E%23%23%23%23",
        actorId: "user@example.com",
        occurredAt: "2026-06-28T02:00:00.000Z",
        plan
      })
    ).toEqual({
      tenantId: "acme",
      stream: "acme:__NamingSeries:Ticket%3ATICK-%2E%23%23%23%23",
      type: "NamingSeriesAdvanced",
      doctype: "__NamingSeries",
      documentName: "Ticket:TICK-.####",
      actorId: "user@example.com",
      occurredAt: "2026-06-28T02:00:00.000Z",
      payload: plan.payload,
      metadata: { target_doctype: "Ticket" }
    });
  });
});

function namingSeriesSnapshot(current: number): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "__NamingSeries",
    name: "Ticket:TICK-.####",
    version: 1,
    docstatus: "draft",
    data: { doctype: "Ticket", pattern: "TICK-.####", current },
    createdAt: "2026-06-28T01:00:00.000Z",
    updatedAt: "2026-06-28T01:00:00.000Z"
  };
}
