import { D1DocumentStore, D1EventStore } from "../../src";
import type { DocumentSnapshot, NewDomainEvent } from "../../src";

describe("D1DocumentStore", () => {
  const stream = "acme:Note:One";
  const event: NewDomainEvent = {
    id: "evt1",
    tenantId: "acme",
    stream,
    type: "NoteCreated",
    doctype: "Note",
    documentName: "One",
    actorId: "owner",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { kind: "DocumentCreated", data: { title: "One" }, docstatus: "draft" },
    metadata: {}
  };

  it("commits event and projection in one batch", async () => {
    const db = new FakeD1Database();
    const store = new D1DocumentStore(db as unknown as D1Database);

    const commit = await store.commit(stream, 0, [event], ([saved]) => snapshotFrom(saved!));

    expect(commit.snapshot).toMatchObject({ name: "One", version: 1 });
    await expect(store.readStream(stream)).resolves.toMatchObject([{ id: "evt1", sequence: 1 }]);
    expect(db.documents.get("acme:Note:One")).toMatchObject({ version: 1 });
  });

  it("rolls back event inserts when projection upsert fails", async () => {
    const db = new FakeD1Database({ failDocumentUpsert: true });
    const store = new D1DocumentStore(db as unknown as D1Database);

    await expect(store.commit(stream, 0, [event], ([saved]) => snapshotFrom(saved!))).rejects.toThrow(
      "projection failed"
    );
    await expect(store.readStream(stream)).resolves.toEqual([]);
    expect(db.documents.size).toBe(0);
  });

  it("reads a bounded recent stream page with bound sequence and limit parameters", async () => {
    const db = new FakeD1Database();
    const store = new D1EventStore(db as unknown as D1Database);
    await store.append(stream, 0, [
      event,
      updateEvent("evt2", "Two"),
      updateEvent("evt3", "Three"),
      updateEvent("evt4", "Four")
    ]);

    const page = await store.readStream(stream, { maxSequence: 3, limit: 2 });

    expect(page.map((item) => item.sequence)).toEqual([2, 3]);
    const read = db.statements.at(-1);
    expect(read?.sql).toContain("sequence <= ?");
    expect(read?.sql).toContain("ORDER BY sequence DESC LIMIT ?");
    expect(read?.params).toEqual([stream, 3, 2]);
  });

  it("filters stream reads by payload kind in SQL", async () => {
    const db = new FakeD1Database();
    const store = new D1EventStore(db as unknown as D1Database);
    await store.append(stream, 0, [
      event,
      updateEvent("evt2", "Two"),
      assignmentEvent("evt3", "DocumentAssigned"),
      assignmentEvent("evt4", "DocumentUnassigned")
    ]);

    const assignments = await store.readStream(stream, {
      maxSequence: 4,
      payloadKinds: ["DocumentAssigned", "DocumentUnassigned"]
    });

    expect(assignments.map((item) => item.payload.kind)).toEqual(["DocumentAssigned", "DocumentUnassigned"]);
    const read = db.statements.at(-1);
    expect(read?.sql).toContain("json_extract(payload_json, '$.kind') IN (?, ?)");
    expect(read?.params).toEqual([stream, 4, "DocumentAssigned", "DocumentUnassigned"]);
  });

  function updateEvent(id: string, title: string): NewDomainEvent {
    return {
      ...event,
      id,
      type: "NoteUpdated",
      payload: { kind: "DocumentUpdated", patch: { title } }
    };
  }

  function assignmentEvent(id: string, kind: "DocumentAssigned" | "DocumentUnassigned"): NewDomainEvent {
    return {
      ...event,
      id,
      type: kind,
      payload: { kind, assigneeId: "amy@example.com" }
    };
  }
});

function snapshotFrom(event: { tenantId: string; doctype: string; documentName: string; sequence: number; occurredAt: string; payload: any }): DocumentSnapshot {
  return {
    tenantId: event.tenantId,
    doctype: event.doctype,
    name: event.documentName,
    version: event.sequence,
    docstatus: event.payload.docstatus,
    data: event.payload.data,
    createdAt: event.occurredAt,
    updatedAt: event.occurredAt
  };
}

class FakeD1Database {
  readonly events: any[] = [];
  readonly documents = new Map<string, any>();
  readonly statements: FakeD1PreparedStatement[] = [];
  readonly failDocumentUpsert: boolean;

  constructor(options: { readonly failDocumentUpsert?: boolean } = {}) {
    this.failDocumentUpsert = options.failDocumentUpsert ?? false;
  }

  prepare(sql: string) {
    const statement = new FakeD1PreparedStatement(this, sql);
    this.statements.push(statement);
    return statement;
  }

  async batch(statements: FakeD1PreparedStatement[]) {
    const events = [...this.events];
    const documents = new Map(this.documents);
    try {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      return results;
    } catch (error) {
      this.events.length = 0;
      this.events.push(...events);
      this.documents.clear();
      for (const [key, value] of documents) {
        this.documents.set(key, value);
      }
      throw error;
    }
  }
}

class FakeD1PreparedStatement {
  params: unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first() {
    if (this.sql.includes("COALESCE(MAX(sequence)")) {
      const stream = String(this.params[0]);
      const version = this.db.events
        .filter((event) => event.stream === stream)
        .reduce((max, event) => Math.max(max, event.sequence), 0);
      return { version };
    }
    return null;
  }

  async all() {
    if (this.sql.includes("FROM cf_frappe_events")) {
      const stream = String(this.params[0]);
      const maxSequence = this.sql.includes("sequence <= ?") ? Number(this.params[1]) : undefined;
      const limit = this.sql.includes("LIMIT ?") ? Number(this.params.at(-1)) : undefined;
      const kindOffset = 1 + (maxSequence === undefined ? 0 : 1);
      const kindParams = this.sql.includes("json_extract(payload_json, '$.kind')")
        ? this.params
            .slice(kindOffset, limit === undefined ? undefined : -1)
            .map(String)
        : undefined;
      const sortDescending = this.sql.includes("ORDER BY sequence DESC");
      const filtered = this.db.events
        .filter((event) => event.stream === stream)
        .filter((event) => maxSequence === undefined || event.sequence <= maxSequence)
        .filter((event) => kindParams === undefined || kindParams.includes(JSON.parse(String(event.payload_json)).kind))
        .sort((left, right) => sortDescending ? right.sequence - left.sequence : left.sequence - right.sequence);
      return {
        results: limit === undefined ? filtered : filtered.slice(0, limit)
      };
    }
    return { results: [] };
  }

  async run() {
    if (this.sql.includes("INSERT INTO cf_frappe_events")) {
      const [
        id,
        tenant_id,
        stream,
        sequence,
        type,
        doctype,
        document_name,
        actor_id,
        occurred_at,
        payload_json,
        metadata_json
      ] = this.params;
      if (this.db.events.some((event) => event.stream === stream && event.sequence === sequence)) {
        throw new Error("UNIQUE constraint failed");
      }
      this.db.events.push({
        id,
        tenant_id,
        stream,
        sequence,
        type,
        doctype,
        document_name,
        actor_id,
        occurred_at,
        payload_json,
        metadata_json
      });
      return { success: true };
    }
    if (this.sql.includes("INSERT INTO cf_frappe_documents")) {
      if (this.db.failDocumentUpsert) {
        throw new Error("projection failed");
      }
      const [tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at] = this.params;
      this.db.documents.set(`${tenant_id}:${doctype}:${name}`, {
        tenant_id,
        doctype,
        name,
        version,
        docstatus,
        data_json,
        created_at,
        updated_at
      });
      return { success: true };
    }
    return { success: true };
  }
}
