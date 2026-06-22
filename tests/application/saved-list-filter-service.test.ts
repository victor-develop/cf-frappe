import { SavedListFilterService } from "../../src";
import { createServices, manager, owner } from "../helpers";

describe("SavedListFilterService", () => {
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
      filters: [{ field: "priority", value: "High" }]
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
          label: "High notes"
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
        { field: "priority", value: "High" },
        { field: "workflow_state", value: "Closed" }
      ]
    });

    expect(updated).toMatchObject({
      id: saved.id,
      label: "Closed high notes",
      filters: [
        { field: "priority", value: "High" },
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
});

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
