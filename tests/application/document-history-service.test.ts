import { DocumentHistoryService, type DomainEvent } from "../../src";
import { createServices, data, owner } from "../helpers";

describe("DocumentHistoryService", () => {
  it("derives chronological timeline entries from the document event stream", async () => {
    const { documents, events, queries } = createServices(["create-1", "update-1", "transition-1", "command-1", "comment-1"]);
    const history = new DocumentHistoryService({ events, queries });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Timeline Note" }) });
    await documents.update({ actor: owner, doctype: "Note", name: "Timeline Note", patch: { body: "Updated" } });
    await documents.transition({ actor: owner, doctype: "Note", name: "Timeline Note", action: "close" });
    await documents.execute({
      actor: owner,
      doctype: "Note",
      name: "Timeline Note",
      command: "rewriteBody",
      input: { body: "Commanded" }
    });
    await documents.comment({
      actor: owner,
      doctype: "Note",
      name: "Timeline Note",
      text: "Ship it"
    });

    const timeline = await history.getTimeline(owner, "Note", "Timeline Note");

    expect(timeline).toMatchObject({
      tenantId: "acme",
      doctype: "Note",
      name: "Timeline Note",
      version: 5
    });
    expect(timeline.entries.map(({ sequence, kind, type, summary }) => ({ sequence, kind, type, summary }))).toEqual([
      {
        sequence: 1,
        kind: "DocumentCreated",
        type: "NoteCreated",
        summary: "Created document"
      },
      {
        sequence: 2,
        kind: "DocumentUpdated",
        type: "NoteUpdated",
        summary: "Updated body"
      },
      {
        sequence: 3,
        kind: "WorkflowTransitioned",
        type: "NoteClose",
        summary: "Closed workflow_state from Open to Closed"
      },
      {
        sequence: 4,
        kind: "DomainCommandApplied",
        type: "NoteBodyRewritten",
        summary: "Applied rewriteBody"
      },
      {
        sequence: 5,
        kind: "DocumentCommentAdded",
        type: "NoteCommentAdded",
        summary: "Commented: Ship it"
      }
    ]);
    expect(timeline.entries[1]).toMatchObject({
      eventId: "evt_update-1",
      actorId: owner.id,
      occurredAt: "2026-01-01T00:00:00.000Z",
      payload: { kind: "DocumentUpdated", patch: { body: "Updated" } }
    });
  });

  it("requires normal document read permission before exposing stream history", async () => {
    const { documents, history } = createServices(["create-1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Private Note" }) });
    const otherUser = { ...owner, id: "other@example.com" };

    await expect(history.getTimeline(otherUser, "Note", "Private Note")).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
  });

  it("summarizes assignment activity and derives current assignees from the event stream", async () => {
    const { documents, history } = createServices(["create-1", "assign-1", "assign-2", "unassign-1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Assigned Note" }) });
    await documents.assign({ actor: owner, doctype: "Note", name: "Assigned Note", assignee: "zoe@example.com" });
    await documents.assign({ actor: owner, doctype: "Note", name: "Assigned Note", assignee: "amy@example.com" });
    await documents.unassign({ actor: owner, doctype: "Note", name: "Assigned Note", assignee: "zoe@example.com" });

    const timeline = await history.getTimeline(owner, "Note", "Assigned Note");
    const assignments = await history.getAssignments(owner, "Note", "Assigned Note");

    expect(timeline.entries.map(({ kind, summary }) => ({ kind, summary }))).toEqual([
      { kind: "DocumentCreated", summary: "Created document" },
      { kind: "DocumentAssigned", summary: "Assigned zoe@example.com" },
      { kind: "DocumentAssigned", summary: "Assigned amy@example.com" },
      { kind: "DocumentUnassigned", summary: "Unassigned zoe@example.com" }
    ]);
    expect(assignments).toMatchObject({
      doctype: "Note",
      name: "Assigned Note",
      version: 4,
      assignees: ["amy@example.com"]
    });
  });

  it("does not expose orphaned events without a readable projection", async () => {
    const { history } = createServices(["create-1"]);

    await expect(history.getTimeline(owner, "Note", "Missing Note")).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND"
    });
  });

  it("does not return events newer than the authorized projection version", async () => {
    const { documents, events, queries } = createServices(["create-1"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Raced Note" }) });
    const [created] = await events.readStream("acme:Note:Raced%20Note");
    const racingEvent: DomainEvent = {
      ...created!,
      id: "evt-racing",
      sequence: 2,
      type: "NoteUpdated",
      payload: { kind: "DocumentUpdated", patch: { body: "Not authorized yet" } }
    };
    const history = new DocumentHistoryService({
      queries,
      events: {
        readStream: async () => [created!, racingEvent]
      }
    });

    const timeline = await history.getTimeline(owner, "Note", "Raced Note");

    expect(timeline.version).toBe(1);
    expect(timeline.entries.map((entry) => entry.sequence)).toEqual([1]);
  });

  it("returns bounded timeline pages with an older-event cursor", async () => {
    const { documents, history } = createServices(["create-1", "update-1", "update-2", "update-3"]);
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Paged Note" }) });
    await documents.update({ actor: owner, doctype: "Note", name: "Paged Note", patch: { body: "One" } });
    await documents.update({ actor: owner, doctype: "Note", name: "Paged Note", patch: { body: "Two" } });
    await documents.update({ actor: owner, doctype: "Note", name: "Paged Note", patch: { body: "Three" } });

    const firstPage = await history.getTimeline(owner, "Note", "Paged Note", { limit: 2 });
    const secondPage = await history.getTimeline(owner, "Note", "Paged Note", {
      limit: 2,
      ...(firstPage.nextBeforeSequence !== undefined ? { beforeSequence: firstPage.nextBeforeSequence } : {})
    });

    expect(firstPage).toMatchObject({
      limit: 2,
      beforeSequence: 4,
      nextBeforeSequence: 2
    });
    expect(firstPage.entries.map((entry) => entry.sequence)).toEqual([3, 4]);
    expect(secondPage.entries.map((entry) => entry.sequence)).toEqual([1, 2]);
    expect(secondPage.nextBeforeSequence).toBeUndefined();
  });
});
