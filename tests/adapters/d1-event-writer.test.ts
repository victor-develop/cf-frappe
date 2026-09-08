import { insertEventStatement, sequenceEvents } from "../../src/adapters/d1/event-writer";
import type { NewDomainEvent } from "../../src";
import { createRecordingD1 } from "../d1-engine.js";

describe("D1 event writer", () => {
  const event: NewDomainEvent = {
    id: "evt1",
    tenantId: "acme",
    stream: "acme:Note:One",
    type: "NoteCreated",
    doctype: "Note",
    documentName: "One",
    actorId: "owner",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { kind: "DocumentCreated", data: { title: "One" }, docstatus: "draft" },
    metadata: { requestId: "req1" }
  };

  it("assigns contiguous stream sequence numbers from the expected version", () => {
    const saved = sequenceEvents(3, [event, { ...event, id: "evt2" }]);

    expect(saved.map((item) => item.sequence)).toEqual([4, 5]);
    expect(saved.map((item) => item.stream)).toEqual(["acme:Note:One", "acme:Note:One"]);
  });

  it("builds one event insert statement with serialized payload and metadata", () => {
    const d1 = createRecordingD1();
    const [saved] = sequenceEvents(0, [event]);

    insertEventStatement(d1.database, saved!);

    expect(d1.only().sql).toContain("INSERT INTO cf_frappe_events");
    expect(d1.only().params).toEqual([
      "evt1",
      "acme",
      "acme:Note:One",
      1,
      "NoteCreated",
      "Note",
      "One",
      "owner",
      "2026-01-01T00:00:00.000Z",
      JSON.stringify(saved!.payload),
      JSON.stringify(saved!.metadata)
    ]);
  });
});
