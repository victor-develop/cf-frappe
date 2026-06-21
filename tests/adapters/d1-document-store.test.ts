import { D1DocumentStore } from "../../src";
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
  readonly failDocumentUpsert: boolean;

  constructor(options: { readonly failDocumentUpsert?: boolean } = {}) {
    this.failDocumentUpsert = options.failDocumentUpsert ?? false;
  }

  prepare(sql: string) {
    return new FakeD1PreparedStatement(this, sql);
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
  private params: unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    private readonly sql: string
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
      return {
        results: this.db.events
          .filter((event) => event.stream === stream)
          .sort((left, right) => left.sequence - right.sequence)
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
