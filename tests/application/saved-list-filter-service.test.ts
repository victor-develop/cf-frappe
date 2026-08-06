import { presentSavedListFilter, SavedListFilterService } from "../../src";
import { createServices, manager, owner } from "../helpers";
import type { DocumentEventPayload, SavedListFilterEventPayload } from "../../src";

describe("SavedListFilterService", () => {
  it("registers saved list filter payloads through the domain event extension map", () => {
    const payload = savedListFilterPayload({
      kind: "SavedListFilterSaved",
      filterId: "filter-high",
      label: "High notes",
      ownerId: owner.id,
      predicate: comparison("priority", "High")
    });

    expect(payload.label).toBe("High notes");
  });

  it("saves normalized user list filters as events and lists only the actor's filters", async () => {
    const { events, registry } = createServices(["create-1"]);
    const savedFilters = new SavedListFilterService({
      registry,
      events,
      ids: deterministicFilterIds(["filter-high", "event-1", "filter-manager", "event-2"]),
      clock: { now: () => "2026-01-02T00:00:00.000Z" }
    });

    const saved = await savedFilters.save({
      actor: owner,
      doctype: "Note",
      label: "High notes",
      filters: [{ field: "priority", value: "High" }]
    });
    await savedFilters.save({
      actor: manager,
      doctype: "Note",
      label: "Manager notes",
      filters: [{ field: "priority", value: "Low" }]
    });

    expect(saved).toMatchObject({
      id: "filter-high",
      doctype: "Note",
      ownerId: owner.id,
      label: "High notes",
      predicate: comparison("priority", "High")
    });
    await expect(savedFilters.list(owner, "Note")).resolves.toMatchObject([
      { id: "filter-high", label: "High notes" }
    ]);
    await expect(events.readStream("acme:__SavedListFilters:Note%3Aowner%40example%2Ecom")).resolves.toMatchObject([
      {
        type: "NoteSavedListFilterSaved",
        documentName: "filter-high",
        payload: {
          kind: "SavedListFilterSaved",
          filterId: "filter-high",
          ownerId: owner.id,
          label: "High notes",
          predicate: comparison("priority", "High")
        }
      }
    ]);
    await expect(events.readStream("acme:__SavedListFilters:Note%3Amanager%40example%2Ecom")).resolves.toMatchObject([
      expect.objectContaining({
        documentName: "filter-manager",
        payload: expect.objectContaining({ ownerId: manager.id })
      })
    ]);
  });

  it("saves and merges compound filter expressions", async () => {
    const { events, registry } = createServices(["create-1"]);
    const savedFilters = new SavedListFilterService({
      registry,
      events,
      ids: deterministicFilterIds(["filter-compound", "event-1"]),
      clock: { now: () => "2026-01-02T00:00:00.000Z" }
    });

    const saved = await savedFilters.save({
      actor: owner,
      doctype: "Note",
      label: "High or mid-count",
      filters: [{ field: "workflow_state", value: "Open" }],
      filterExpression: {
        kind: "group",
        match: "any",
        filters: [
          { field: "priority", value: "High" },
          { field: "count", operator: "between", value: ["2", "5"] }
        ]
      }
    });

    expect(saved).toMatchObject({
      predicate: {
        kind: "group",
        match: "all",
        predicates: [
          {
            kind: "compare",
            left: { kind: "field", scope: "after", field: "workflow_state" },
            operator: "eq",
            right: { kind: "literal", value: "Open" }
          },
          {
            kind: "group",
            match: "any",
            predicates: [
              {
                kind: "compare",
                left: { kind: "field", scope: "after", field: "priority" },
                operator: "eq",
                right: { kind: "literal", value: "High" }
              },
              {
                kind: "compare",
                left: { kind: "field", scope: "after", field: "count" },
                operator: "between",
                right: { kind: "literal", value: [2, 5] }
              }
            ]
          }
        ]
      }
    });
    expect(saved).not.toHaveProperty("filterExpression");
    const persisted = await events.readStream("acme:__SavedListFilters:Note%3Aowner%40example%2Ecom");
    expect(persisted).toMatchObject([
      {
        payload: {
          kind: "SavedListFilterSaved",
          predicate: {
            kind: "group",
            match: "all",
            predicates: [
              {
                kind: "compare",
                left: { kind: "field", scope: "after", field: "workflow_state" },
                operator: "eq",
                right: { kind: "literal", value: "Open" }
              },
              {
                kind: "group",
                match: "any",
                predicates: [
                  {
                    kind: "compare",
                    left: { kind: "field", scope: "after", field: "priority" },
                    operator: "eq",
                    right: { kind: "literal", value: "High" }
                  },
                  {
                    kind: "compare",
                    left: { kind: "field", scope: "after", field: "count" },
                    operator: "between",
                    right: { kind: "literal", value: [2, 5] }
                  }
                ]
              }
            ]
          }
        }
      }
    ]);
    expect(persisted[0]?.payload).not.toHaveProperty("filterExpression");

    const secondService = new SavedListFilterService({ registry, events });
    const folded = await secondService.get(owner, "Note", saved.id);
    expect(folded.predicate).toEqual(saved.predicate);
    expect(presentSavedListFilter(folded)).toMatchObject({
      filters: [{ field: "workflow_state", value: "Open" }],
      filterExpression: {
        kind: "group",
        match: "any",
        filters: [
          { field: "priority", value: "High" },
          { field: "count", operator: "between", value: [2, 5] }
        ]
      }
    });
    expect(presentSavedListFilter(folded)).not.toHaveProperty("predicate");
    expect(
      secondService.mergeSavedFilterInputs(
        folded,
        [{ field: "priority", value: "Low" }],
        { field: "system.name", operator: "contains", value: "Q2" }
      )
    ).toMatchObject({
      filters: [
        { field: "workflow_state", value: "Open" },
        { field: "priority", value: "Low" },
        { field: "system.name", operator: "contains", value: "Q2" }
      ],
      filterExpression: {
        kind: "group",
        match: "any",
        filters: [
          { field: "priority", value: "High" },
          { field: "count", operator: "between", value: [2, 5] }
        ]
      }
    });

    const explicitExpression = {
      kind: "group" as const,
      match: "all" as const,
      filters: [
        { field: "priority", value: "High" },
        {
          kind: "group" as const,
          match: "any" as const,
          filters: [
            { field: "count", operator: "between" as const, value: [1, 1] },
            { field: "priority", operator: "ne" as const, value: "Low" }
          ]
        }
      ]
    };
    expect(secondService.mergeSavedFilterInputs(undefined, [], explicitExpression)).toEqual({
      filters: [],
      filterExpression: explicitExpression
    });
  });

  it("updates and deletes only filters owned by the actor", async () => {
    const { events, registry } = createServices(["create-1"]);
    const savedFilters = new SavedListFilterService({
      registry,
      events,
      ids: deterministicFilterIds(["filter-1", "event-1", "event-2", "event-3"]),
      clock: { now: () => "2026-01-02T00:00:00.000Z" }
    });
    const saved = await savedFilters.save({
      actor: owner,
      doctype: "Note",
      label: "High notes",
      filters: [{ field: "priority", value: "High" }]
    });

    await expect(
      savedFilters.save({
        actor: manager,
        doctype: "Note",
        id: saved.id,
        label: "Manager overwrite",
        filters: [{ field: "priority", value: "Low" }]
      })
    ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });

    const updated = await savedFilters.save({
      actor: owner,
      doctype: "Note",
      id: saved.id,
      label: "Closed high notes",
      filters: [
        { field: "priority", operator: "in", value: ["High", "Medium"] },
        { field: "workflow_state", value: "Closed" }
      ]
    });

    expect(updated).toMatchObject({
      id: saved.id,
      label: "Closed high notes",
      predicate: {
        kind: "group",
        match: "all"
      }
    });
    expect(presentSavedListFilter(updated)).toMatchObject({
      filters: [
        { field: "priority", operator: "in", value: ["High", "Medium"] },
        { field: "workflow_state", value: "Closed" }
      ]
    });

    const secondService = new SavedListFilterService({ registry, events });
    await expect(secondService.get(owner, "Note", saved.id)).resolves.toMatchObject({
      label: "Closed high notes"
    });

    await expect(savedFilters.get(manager, "Note", saved.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(savedFilters.delete({ actor: manager, doctype: "Note", id: saved.id })).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND"
    });
    await savedFilters.delete({ actor: owner, doctype: "Note", id: saved.id });
    await expect(savedFilters.list(owner, "Note")).resolves.toEqual([]);
  });

  it("requires read permission, valid labels, and metadata-valid filters", async () => {
    const { events, registry } = createServices(["create-1"]);
    const savedFilters = new SavedListFilterService({
      registry,
      events,
      ids: deterministicFilterIds(["filter-1", "event-1"]),
      clock: { now: () => "2026-01-02T00:00:00.000Z" }
    });

    await expect(
      savedFilters.save({
        actor: { id: "stranger@example.com", roles: ["Stranger"], tenantId: "acme" },
        doctype: "Note",
        label: "Guest notes",
        filters: [{ field: "priority", value: "High" }]
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      savedFilters.save({ actor: owner, doctype: "Note", label: "  ", filters: [] })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Saved filter label is required"
    });
    await expect(
      savedFilters.save({
        actor: owner,
        doctype: "Note",
        label: "Invalid",
        filters: [{ field: "missing", value: "x" }]
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects saved filter conditions that exceed the shared Predicate node budget", async () => {
    const { events, registry } = createServices(["create-1"]);
    const savedFilters = new SavedListFilterService({ registry, events });

    await expect(savedFilters.save({
      actor: owner,
      doctype: "Note",
      label: "Oversized",
      filters: Array.from({ length: 64 }, () => ({ field: "priority", value: "High" }))
    })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Predicate expression cannot exceed 5 levels or 64 nodes"
    });

    await expect(savedFilters.save({
      actor: owner,
      doctype: "Note",
      label: "Combined oversized",
      filters: Array.from({ length: 31 }, () => ({ field: "priority", value: "High" })),
      filterExpression: {
        kind: "group",
        match: "any",
        filters: Array.from({ length: 32 }, () => ({ field: "priority", operator: "ne" as const, value: "Low" }))
      }
    })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Predicate expression cannot exceed 5 levels or 64 nodes"
    });
    await expect(events.readStream("acme:__SavedListFilters:Note%3Aowner%40example%2Ecom")).resolves.toEqual([]);
  });
});

function savedListFilterPayload(
  payload: Extract<DocumentEventPayload, { readonly kind: "SavedListFilterSaved" }>
): Extract<SavedListFilterEventPayload, { readonly kind: "SavedListFilterSaved" }> {
  return payload;
}

function comparison(field: string, value: string) {
  return {
    kind: "compare" as const,
    left: { kind: "field" as const, scope: "after" as const, field },
    operator: "eq" as const,
    right: { kind: "literal" as const, value }
  };
}

function deterministicFilterIds(values: readonly string[]) {
  let index = 0;
  return {
    next() {
      const value = values[index++];
      if (value === undefined) {
        throw new Error("No deterministic saved filter id left");
      }
      return value;
    }
  };
}
