import {
  foldSavedListFilters,
  isSavedListFilterEvent,
  isSavedListFilterPayloadKind,
  mergeSavedListFilterInputs,
  normalizeSavedListFilterLabel,
  SAVED_LIST_FILTER_PAYLOAD_KINDS,
  savedListFilterCurrentVersion,
  savedListFilterEvent,
  savedListFiltersForOwner,
  sortedSavedListFilters
} from "../../src";
import type { DomainEvent, SavedListFilter, SavedListFilterEventPayload } from "../../src";
import { manager, noteDocType, owner } from "../helpers";

describe("saved list filter events", () => {
  it("folds save, update, and delete events by sequence", () => {
    const state = foldSavedListFilters("acme", noteDocType, [
      savedEvent(3, {
        filterId: "filter-a",
        label: "Alpha updated",
        ownerId: owner.id,
        predicate: comparison("workflow_state", "Closed")
      }, "2026-01-01T00:03:00.000Z"),
      deletedEvent(4, "filter-b", manager.id),
      savedEvent(1, {
        filterId: "filter-a",
        label: "Alpha",
        ownerId: owner.id,
        predicate: comparison("priority", "High")
      }, "2026-01-01T00:01:00.000Z"),
      savedEvent(2, {
        filterId: "filter-b",
        label: "Beta",
        ownerId: manager.id,
        predicate: comparison("priority", "Low")
      }, "2026-01-01T00:02:00.000Z")
    ]);

    expect(state).toMatchObject({ tenantId: "acme", doctype: "Note", version: 4 });
    expect(state.filters.get("filter-a")).toMatchObject({
      id: "filter-a",
      label: "Alpha updated",
      ownerId: owner.id,
      predicate: comparison("workflow_state", "Closed"),
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:03:00.000Z"
    });
    expect(state.filters.has("filter-b")).toBe(false);
  });

  it("projects owner filters and sorts them by label with id ties", () => {
    const state = foldSavedListFilters("acme", noteDocType, [
      savedEvent(1, {
        filterId: "filter-z",
        label: "Zeta",
        ownerId: owner.id,
        predicate: comparison("priority", "High")
      }),
      savedEvent(2, {
        filterId: "filter-b",
        label: "Alpha",
        ownerId: owner.id,
        predicate: comparison("priority", "Medium")
      }),
      savedEvent(3, {
        filterId: "filter-a",
        label: "Alpha",
        ownerId: owner.id,
        predicate: comparison("priority", "Low")
      }),
      savedEvent(4, {
        filterId: "manager-only",
        label: "Manager",
        ownerId: manager.id,
        predicate: comparison("priority", "Low")
      })
    ]);

    expect(sortedSavedListFilters(savedListFiltersForOwner(state, owner.id)).map((filter) => filter.id)).toEqual([
      "filter-a",
      "filter-b",
      "filter-z"
    ]);
  });

  it("merges saved and explicit list filter inputs without service orchestration", () => {
    const savedFilter = {
      tenantId: "acme",
      doctype: "Note",
      id: "filter-a",
      label: "Important",
      ownerId: owner.id,
      predicate: comparison("priority", "High"),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    } satisfies SavedListFilter;

    expect(mergeSavedListFilterInputs({
      savedFilter,
      explicitPredicate: comparison("status", "Active")
    })).toEqual({
      predicate: {
        kind: "group",
        match: "all",
        predicates: [
          comparison("priority", "High"),
          comparison("status", "Active")
        ]
      }
    });
  });

  it("normalizes labels, exposes payload kinds, and reads append versions", () => {
    expect(normalizeSavedListFilterLabel("  Active notes  ")).toBe("Active notes");
    expect(() => normalizeSavedListFilterLabel("  ")).toThrow("Saved filter label is required");
    expect(() => normalizeSavedListFilterLabel("x".repeat(141))).toThrow(
      "Saved filter label exceeds 140 characters"
    );
    expect(SAVED_LIST_FILTER_PAYLOAD_KINDS).toEqual([
      "SavedListFilterSaved",
      "SavedListFilterDeleted"
    ]);
    expect(savedListFilterCurrentVersion([
      savedEvent(3, {
        filterId: "filter-a",
        label: "Alpha",
        ownerId: owner.id
      })
    ])).toBe(3);
    expect(savedListFilterEvent({
      id: "evt_new",
      tenantId: "acme",
      stream: "acme:__SavedListFilters:Note%3Aowner%40example%2Ecom",
      type: "NoteSavedListFilterDeleted",
      doctype: "Note",
      documentName: "filter-a",
      actorId: owner.id,
      occurredAt: "2026-01-01T00:04:00.000Z",
      payload: {
        kind: "SavedListFilterDeleted",
        filterId: "filter-a",
        ownerId: owner.id
      },
      metadata: {}
    }).payload.kind).toBe("SavedListFilterDeleted");
  });

  it("narrows saved list filter events by payload kind when event type names are custom", () => {
    const saved = savedEvent(1, {
      filterId: "filter-a",
      label: "Alpha",
      ownerId: owner.id,
      predicate: comparison("priority", "High")
    });
    const imported = { ...saved, type: "NoteListViewPresetImported" };

    expect(isSavedListFilterPayloadKind("SavedListFilterSaved")).toBe(true);
    expect(isSavedListFilterPayloadKind("DocumentDeleted")).toBe(false);
    expect(isSavedListFilterEvent(imported)).toBe(true);
    expect(isSavedListFilterEvent(otherEvent({ kind: "DocumentDeleted" }))).toBe(false);
  });

  it("folds saved list filters by payload kind instead of event type name", () => {
    const misleadingUnrelated = otherEvent({ kind: "DocumentDeleted" }, "NoteSavedListFilterSaved");
    const customTypedSaved = {
      ...savedEvent(2, {
        filterId: "filter-a",
        label: "Alpha",
        ownerId: owner.id,
        predicate: comparison("workflow_state", "Open")
      }),
      type: "NoteListViewPresetImported"
    };

    const state = foldSavedListFilters("acme", noteDocType, [misleadingUnrelated, customTypedSaved]);

    expect(state.version).toBe(2);
    expect(state.filters.size).toBe(1);
    expect(state.filters.get("filter-a")).toMatchObject({
      id: "filter-a",
      label: "Alpha",
      ownerId: owner.id,
      predicate: comparison("workflow_state", "Open")
    });
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

function comparison(field: string, value: string) {
  return {
    kind: "compare" as const,
    left: { kind: "field" as const, scope: "after" as const, field },
    operator: "eq" as const,
    right: { kind: "literal" as const, value }
  };
}

function savedEvent(
  sequence: number,
  payload: Omit<Extract<SavedListFilterEventPayload, { readonly kind: "SavedListFilterSaved" }>, "kind">,
  occurredAt = "2026-01-01T00:00:00.000Z"
): DomainEvent {
  return event(sequence, payload.filterId, { kind: "SavedListFilterSaved", ...payload }, occurredAt);
}

function deletedEvent(sequence: number, filterId: string, ownerId: string): DomainEvent {
  return event(sequence, filterId, {
    kind: "SavedListFilterDeleted",
    filterId,
    ownerId
  }, "2026-01-01T00:04:00.000Z");
}

function event(
  sequence: number,
  filterId: string,
  payload: SavedListFilterEventPayload,
  occurredAt: string
): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: "acme:__SavedListFilters:Note%3Aowner%40example%2Ecom",
    sequence,
    type: `Note${payload.kind}`,
    doctype: "Note",
    documentName: filterId,
    actorId: payload.ownerId,
    occurredAt,
    payload,
    metadata: {}
  };
}
