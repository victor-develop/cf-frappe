import {
  DocumentService,
  InMemoryDocumentStore,
  QueryService,
  SYSTEM_MANAGER_ROLE,
  createRegistry,
  defineDocType,
  deterministicIds,
  fixedClock
} from "../../src";
import type { Actor } from "../../src";
import { now } from "../helpers";
import { afterField } from "../predicate-fixtures.js";

const hr: Actor = { id: "hr@example.com", roles: ["HR"], tenantId: "acme" };
const alice: Actor = { id: "alice@example.com", roles: ["Employee"], tenantId: "acme" };
const bob: Actor = { id: "bob@example.com", roles: ["Employee"], tenantId: "acme" };
const contractor: Actor = { id: "contractor@example.com", roles: ["Contractor"], tenantId: "acme" };
const admin: Actor = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

const EmployeeRecord = defineDocType({
  name: "Employee Record",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "employee", type: "text", required: true },
    { name: "status", type: "select", options: ["Open", "Locked"] },
    { name: "summary", type: "text", readOnlyDependsOn: afterField("status", "Locked") },
    { name: "badge", type: "text", hidden: true },
    // Hidden whenever the salary it depends on is above a threshold. Salary is
    // withheld from other employees, so this must not reveal it.
    { name: "bonus_note", type: "text", hiddenDependsOn: afterField("salary", 100_000, "gt") },
    {
      name: "salary",
      type: "number",
      permissions: [
        { roles: ["HR"], actions: ["read", "create", "update"] },
        {
          roles: ["Employee"],
          actions: ["read"],
          when: ({ actor, document }) => document?.data.employee === actor.id
        }
      ]
    },
    {
      // Writable by any employee, readable only by the record's owner — the
      // case where a form would blank a value it cannot show.
      name: "peer_feedback",
      type: "longText",
      permissions: [
        { roles: ["HR"], actions: ["read", "create", "update"] },
        { roles: ["Employee"], actions: ["update"] },
        {
          roles: ["Employee"],
          actions: ["read"],
          when: ({ actor, document }) => document?.data.employee === actor.id
        }
      ]
    },
    {
      name: "internal_notes",
      type: "longText",
      permissions: [{ roles: ["HR"], actions: ["read", "create", "update"] }]
    }
  ],
  permissions: [{ roles: ["Employee", "HR", "Contractor"], actions: ["read", "create", "update"] }]
});

const Memo = defineDocType({
  name: "Memo",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "body", type: "longText" },
    { name: "revision_note", type: "text", allowOnSubmit: true }
  ],
  permissions: [{ roles: ["Employee"], actions: ["read", "create", "update", "submit", "cancel"] }]
});

const Ticket = defineDocType({
  name: "Ticket",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "workflow_state", type: "select", options: ["Open", "Closed"], defaultValue: "Open" }
  ],
  workflows: [{
    name: "lifecycle",
    stateField: "workflow_state",
    initialState: "Open",
    states: ["Open", "Closed"],
    transitions: [{ action: "close", from: "Open", to: "Closed" }]
  }],
  permissions: [{ roles: ["Employee"], actions: ["read", "create", "update"] }]
});

const ReadOnlyEmployeeRecord = defineDocType({
  ...EmployeeRecord,
  name: "Archived Record",
  permissions: [{ roles: ["Employee", "HR"], actions: ["read"] }]
});

function services() {
  const registry = createRegistry({ doctypes: [EmployeeRecord, Memo, Ticket, ReadOnlyEmployeeRecord] });
  const store = new InMemoryDocumentStore();
  const documents = new DocumentService({
    registry,
    store,
    clock: fixedClock(now),
    ids: deterministicIds(Array.from({ length: 100 }, (_unused, index) => `evt-${index}`))
  });
  const queries = new QueryService({ registry, projections: store });
  return { documents, queries };
}

async function createRecord(
  documents: DocumentService,
  title: string,
  employee: string,
  extra: Record<string, string | number> = {},
  doctype = "Employee Record"
) {
  return documents.create({
    actor: admin,
    doctype,
    data: {
      title,
      employee,
      status: "Open",
      summary: "Summary",
      badge: "B",
      bonus_note: "Note",
      salary: 120_000,
      peer_feedback: "Private",
      internal_notes: "HR-only",
      ...extra
    }
  });
}

describe("document field states", () => {
  it("reports read, write, and redaction per actor and per document", async () => {
    const { documents, queries } = services();
    await createRecord(documents, "Alice Record", alice.id);

    const own = await queries.getDocumentWithFieldStates(alice, "Employee Record", "Alice Record");
    const other = await queries.getDocumentWithFieldStates(bob, "Employee Record", "Alice Record");
    const asHr = await queries.getDocumentWithFieldStates(hr, "Employee Record", "Alice Record");

    expect(own.fieldStates.title).toEqual({ read: true, write: true });
    expect(own.fieldStates.salary).toEqual({ read: true, write: false });
    expect(own.fieldStates.peer_feedback).toEqual({ read: true, write: true });
    expect(other.fieldStates.salary).toEqual({ read: false, write: false, redacted: true });
    expect(other.fieldStates.peer_feedback).toEqual({ read: false, write: true, redacted: true });
    expect(asHr.fieldStates.salary).toEqual({ read: true, write: true });
    expect(asHr.fieldStates.internal_notes).toEqual({ read: true, write: true });
  });

  it("agrees with the document it is returned with", async () => {
    const { documents, queries } = services();
    await createRecord(documents, "Alice Record", alice.id);

    for (const actor of [alice, bob, hr, admin]) {
      const { document, fieldStates } = await queries.getDocumentWithFieldStates(actor, "Employee Record", "Alice Record");
      for (const [field, state] of Object.entries(fieldStates)) {
        expect([actor.id, field, Object.prototype.hasOwnProperty.call(document.data, field)])
          .toEqual([actor.id, field, state.read]);
      }
      expect(document).toEqual(await queries.getDocument(actor, "Employee Record", "Alice Record"));
    }
  });

  it("leaves out a field the caller may not know exists, as the metadata does", async () => {
    const { documents, queries } = services();
    await createRecord(documents, "Alice Record", alice.id);

    const { fieldStates } = await queries.getDocumentWithFieldStates(alice, "Employee Record", "Alice Record");
    const meta = await queries.getEffectiveMeta(alice, "Employee Record");

    expect(fieldStates).not.toHaveProperty("internal_notes");
    expect(Object.keys(fieldStates)).toEqual(meta.fields.map((field) => field.name));
  });

  it("marks readOnlyDependsOn fields unwritable, and a write agrees", async () => {
    const { documents, queries } = services();
    await createRecord(documents, "Locked Record", alice.id, { status: "Locked" });

    const { fieldStates } = await queries.getDocumentWithFieldStates(alice, "Employee Record", "Locked Record");

    expect(fieldStates.summary).toEqual({ read: true, write: false });
    await expect(documents.update({
      actor: alice,
      doctype: "Employee Record",
      name: "Locked Record",
      patch: { summary: "Changed" }
    })).rejects.toMatchObject({ issues: [expect.objectContaining({ field: "summary", code: "readonly" })] });
  });

  it("reports hidden as a display hint evaluated on what the caller can see", async () => {
    const { documents, queries } = services();
    await createRecord(documents, "Alice Record", alice.id);

    const own = await queries.getDocumentWithFieldStates(alice, "Employee Record", "Alice Record");
    const other = await queries.getDocumentWithFieldStates(bob, "Employee Record", "Alice Record");

    expect(own.fieldStates.badge).toEqual({ read: true, write: true, hidden: true });
    expect(own.document.data.badge).toBe("B");
    expect(own.fieldStates.bonus_note).toEqual({ read: true, write: true, hidden: true });
    // Bob cannot see the salary, so the salary-dependent rule must not fire for
    // him — otherwise `hidden` would tell him the salary is over 100k.
    expect(other.fieldStates.bonus_note).toEqual({ read: true, write: true });
  });

  it("does not leak a value through hidden when the field is absent from the caller's metadata", async () => {
    // Contractor matches no salary rule at all, so salary is not merely redacted
    // for them but missing from their metadata — the other way a value can be
    // withheld, and the one an allow-list of readable fields has to cover.
    const { documents, queries } = services();
    await createRecord(documents, "Alice Record", alice.id);

    const { fieldStates } = await queries.getDocumentWithFieldStates(contractor, "Employee Record", "Alice Record");

    expect(fieldStates).not.toHaveProperty("salary");
    expect(fieldStates.bonus_note).toEqual({ read: true, write: true });
  });

  it("allows only allowOnSubmit fields once submitted, and nothing once cancelled", async () => {
    const { documents, queries } = services();
    await documents.create({ actor: alice, doctype: "Memo", data: { title: "Memo", body: "Body", revision_note: "r" } });

    const draft = await queries.getDocumentWithFieldStates(alice, "Memo", "Memo");
    await documents.submit({ actor: alice, doctype: "Memo", name: "Memo" });
    const submitted = await queries.getDocumentWithFieldStates(alice, "Memo", "Memo");
    await documents.cancel({ actor: alice, doctype: "Memo", name: "Memo" });
    const cancelled = await queries.getDocumentWithFieldStates(alice, "Memo", "Memo");

    expect(draft.fieldStates.body?.write).toBe(true);
    expect(submitted.fieldStates.body?.write).toBe(false);
    expect(submitted.fieldStates.revision_note?.write).toBe(true);
    expect(cancelled.fieldStates.revision_note?.write).toBe(false);
  });

  it("does not offer the workflow state field for a direct write", async () => {
    const { documents, queries } = services();
    await documents.create({ actor: alice, doctype: "Ticket", data: { title: "T" } });

    const { fieldStates } = await queries.getDocumentWithFieldStates(alice, "Ticket", "T");

    expect(fieldStates.title?.write).toBe(true);
    expect(fieldStates.workflow_state).toEqual({ read: true, write: false });
  });

  it("reports nothing writable without update permission on the document", async () => {
    const { documents, queries } = services();
    await createRecord(documents, "Archived", alice.id, {}, "Archived Record");

    const { fieldStates } = await queries.getDocumentWithFieldStates(hr, "Archived Record", "Archived");

    expect(Object.values(fieldStates).some((state) => state.write)).toBe(false);
  });

  it("attaches list field states only when asked, keyed by document name", async () => {
    const { documents, queries } = services();
    await createRecord(documents, "Alice Record", alice.id);
    await createRecord(documents, "Bob Record", bob.id);

    const plain = await queries.listDocumentsForView(alice, "Employee Record", { orderBy: "title", order: "asc" });
    const withStates = await queries.listDocumentsForView(alice, "Employee Record", {
      orderBy: "title",
      order: "asc",
      withFieldStates: true
    });

    expect(plain.result).not.toHaveProperty("fieldStates");
    expect(withStates.result.data).toEqual(plain.result.data);
    expect(Object.keys(withStates.result.fieldStates ?? {})).toEqual(["Alice Record", "Bob Record"]);
    expect(withStates.result.fieldStates?.["Alice Record"]).toEqual(
      (await queries.getDocumentWithFieldStates(alice, "Employee Record", "Alice Record")).fieldStates
    );
    expect(withStates.result.fieldStates?.["Bob Record"]?.salary).toEqual({ read: false, write: false, redacted: true });
  });

  it("projects the document form from the same states", async () => {
    const { documents, queries } = services();
    await createRecord(documents, "Alice Record", alice.id, { status: "Locked" });

    const own = await queries.getEffectiveDocumentFormView(alice, "Employee Record", "Alice Record");
    const other = await queries.getEffectiveDocumentFormView(bob, "Employee Record", "Alice Record");
    const ownFields = new Map(own.fields.map((field) => [field.name, field]));
    const otherFields = new Map(other.fields.map((field) => [field.name, field]));

    // Left editable on purpose: Desk does not re-evaluate readOnlyDependsOn as
    // the user types, so fixing it from the stored state would drop an edit made
    // in the same save that unlocks the field. The write path still enforces it.
    expect(ownFields.get("summary")?.readOnly).not.toBe(true);
    expect(ownFields.get("peer_feedback")?.readOnly).not.toBe(true);
    // Writable but not readable for Bob: an editable input would render empty
    // and saving the form would overwrite what Alice wrote.
    expect(otherFields.get("peer_feedback")?.readOnly).toBe(true);
  });
});
