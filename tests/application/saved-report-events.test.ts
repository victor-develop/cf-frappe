import {
  foldSavedReports,
  isSavedReportEvent,
  isSavedReportPayloadKind,
  normalizeSavedReportLabel,
  savedReportCurrentVersion,
  savedReportDefinitionFromPayload,
  savedReportDefinitionToPayload,
  savedReportEvent,
  savedReportsForOwner,
  savedReportToReportDefinition,
  sortedSavedReports
} from "../../src";
import type { DomainEvent, SavedReportEventPayload } from "../../src";
import { manager, noteDocType, owner } from "../helpers";

describe("saved report events", () => {
  it("folds save, update, and delete events by sequence", () => {
    const state = foldSavedReports("acme", noteDocType, [
      savedEvent(3, {
        reportId: "report-a",
        label: "Alpha updated",
        ownerId: owner.id,
        definition: {
          columns: [{ name: "priority" }],
          orderBy: "priority",
          order: "desc"
        }
      }, "2026-01-01T00:03:00.000Z"),
      deletedEvent(4, "report-b", manager.id),
      savedEvent(1, {
        reportId: "report-a",
        label: "Alpha",
        ownerId: owner.id,
        definition: { columns: [{ name: "title" }] }
      }, "2026-01-01T00:01:00.000Z"),
      savedEvent(2, {
        reportId: "report-b",
        label: "Beta",
        ownerId: manager.id,
        definition: { columns: [{ name: "count" }] }
      }, "2026-01-01T00:02:00.000Z")
    ]);

    expect(state).toMatchObject({ tenantId: "acme", doctype: "Note", version: 4 });
    expect(state.reports.get("report-a")).toMatchObject({
      id: "report-a",
      label: "Alpha updated",
      ownerId: owner.id,
      definition: {
        columns: [{ name: "priority" }],
        orderBy: "priority",
        order: "desc"
      },
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:03:00.000Z"
    });
    expect(state.reports.has("report-b")).toBe(false);
  });

  it("projects owner reports and sorts them by label with id ties", () => {
    const state = foldSavedReports("acme", noteDocType, [
      savedEvent(1, {
        reportId: "report-z",
        label: "Zeta",
        ownerId: owner.id,
        definition: { columns: [{ name: "title" }] }
      }),
      savedEvent(2, {
        reportId: "report-b",
        label: "Alpha",
        ownerId: owner.id,
        definition: { columns: [{ name: "priority" }] }
      }),
      savedEvent(3, {
        reportId: "report-a",
        label: "Alpha",
        ownerId: owner.id,
        definition: { columns: [{ name: "count" }] }
      }),
      savedEvent(4, {
        reportId: "manager-only",
        label: "Manager",
        ownerId: manager.id,
        definition: { columns: [{ name: "title" }] }
      })
    ]);

    expect(sortedSavedReports(savedReportsForOwner(state, owner.id)).map((report) => report.id)).toEqual([
      "report-a",
      "report-b",
      "report-z"
    ]);
  });

  it("round-trips report definitions and builds runtime report metadata", () => {
    const definition = {
      columns: [
        { name: "title", label: "Title" },
        { name: "count", label: "Count" },
        {
          name: "adjusted_count",
          type: "number" as const,
          formula: { operator: "add" as const, left: "count", right: 1 }
        }
      ],
      filters: [{ name: "count_range", field: "count", operator: "between" as const, defaultValue: [2, 8] }],
      filterExpression: {
        kind: "group" as const,
        match: "all" as const,
        filters: [{ filter: "count_range", value: [2, 8] }]
      },
      orderBy: "count",
      order: "asc" as const
    };

    const payload = savedReportDefinitionToPayload(definition);
    expect(savedReportDefinitionFromPayload(payload)).toMatchObject(definition);
    expect(savedReportToReportDefinition({
      tenantId: "acme",
      doctype: "Note",
      id: "report-counts/v1",
      label: "Counts",
      ownerId: owner.id,
      definition,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    })).toMatchObject({
      name: "Saved Report report counts v1",
      label: "Counts",
      doctype: "Note",
      orderBy: "count"
    });
  });

  it("normalizes labels and reads append versions", () => {
    expect(normalizeSavedReportLabel("  Active reports  ")).toBe("Active reports");
    expect(() => normalizeSavedReportLabel("  ")).toThrow("Saved report label is required");
    expect(() => normalizeSavedReportLabel("x".repeat(141))).toThrow(
      "Saved report label exceeds 140 characters"
    );
    expect(savedReportCurrentVersion([
      savedEvent(7, {
        reportId: "report-a",
        label: "Alpha",
        ownerId: owner.id,
        definition: { columns: [{ name: "title" }] }
      })
    ])).toBe(7);
    expect(savedReportEvent({
      id: "evt_new",
      tenantId: "acme",
      stream: "acme:__SavedReports:Note%3Aowner%40example%2Ecom",
      type: "NoteSavedReportDeleted",
      doctype: "Note",
      documentName: "report-a",
      actorId: owner.id,
      occurredAt: "2026-01-01T00:04:00.000Z",
      payload: {
        kind: "SavedReportDeleted",
        reportId: "report-a",
        ownerId: owner.id
      },
      metadata: {}
    }).payload.kind).toBe("SavedReportDeleted");
  });

  it("narrows saved report events by payload kind when event type names are custom", () => {
    const saved = savedEvent(1, {
      reportId: "report-a",
      label: "Alpha",
      ownerId: owner.id,
      definition: { columns: [{ name: "title" }] }
    });
    const imported = { ...saved, type: "NoteAnalyticsViewImported" };

    expect(isSavedReportPayloadKind("SavedReportSaved")).toBe(true);
    expect(isSavedReportPayloadKind("DocumentDeleted")).toBe(false);
    expect(isSavedReportEvent(imported)).toBe(true);
    expect(isSavedReportEvent(otherEvent({ kind: "DocumentDeleted" }))).toBe(false);
  });
});

function otherEvent(payload: DomainEvent["payload"], type: string = payload.kind): DomainEvent {
  return {
    id: "evt_other",
    tenantId: "acme",
    stream: "acme:Note:NOTE-1",
    sequence: 1,
    type,
    doctype: "Note",
    documentName: "NOTE-1",
    actorId: owner.id,
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload,
    metadata: {}
  };
}

function savedEvent(
  sequence: number,
  payload: Omit<Extract<SavedReportEventPayload, { readonly kind: "SavedReportSaved" }>, "kind">,
  occurredAt = "2026-01-01T00:00:00.000Z"
): DomainEvent {
  return event(sequence, payload.reportId, { kind: "SavedReportSaved", ...payload }, occurredAt);
}

function deletedEvent(sequence: number, reportId: string, ownerId: string): DomainEvent {
  return event(sequence, reportId, {
    kind: "SavedReportDeleted",
    reportId,
    ownerId
  }, "2026-01-01T00:04:00.000Z");
}

function event(
  sequence: number,
  reportId: string,
  payload: SavedReportEventPayload,
  occurredAt: string
): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: "acme:__SavedReports:Note%3Aowner%40example%2Ecom",
    sequence,
    type: `Note${payload.kind}`,
    doctype: "Note",
    documentName: reportId,
    actorId: payload.ownerId,
    occurredAt,
    payload,
    metadata: {}
  };
}
