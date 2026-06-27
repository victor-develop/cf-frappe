import { insertEventStatement, sequenceEvents } from "../../src/adapters/d1/event-writer";
import type { NewDomainEvent } from "../../src";

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
    const db = new FakeD1Database();
    const [saved] = sequenceEvents(0, [event]);

    const statement = insertEventStatement(db as unknown as D1Database, saved!);

    expect(statement).toBe(db.statement);
    expect(db.statement.sql).toContain("INSERT INTO cf_frappe_events");
    expect(db.statement.params).toEqual([
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

class FakeD1Database {
  readonly statement = new FakeD1PreparedStatement();

  prepare(sql: string): FakeD1PreparedStatement {
    this.statement.sql = sql;
    return this.statement;
  }
}

class FakeD1PreparedStatement {
  sql = "";
  params: unknown[] = [];

  bind(...params: unknown[]): this {
    this.params = params;
    return this;
  }
}
