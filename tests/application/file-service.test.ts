import {
  createRegistry,
  deterministicIds,
  DocumentService,
  fileDocType,
  FileService,
  fixedClock,
  InMemoryDocumentStore,
  InMemoryFileStorage,
  QueryService
} from "../../src";
import type { FileStorage, PutFileObjectCommand } from "../../src";
import { guest, now, owner } from "../helpers";

const otherUser = {
  id: "other@example.com",
  roles: ["User"],
  tenantId: "acme"
};

describe("FileService", () => {
  it("stores bytes and creates event-sourced File metadata", async () => {
    const services = createFileServices();

    const uploaded = await services.files.upload({
      actor: owner,
      filename: "invoice.pdf",
      body: "hello",
      contentType: "application/pdf",
      isPrivate: false
    });

    expect(uploaded.snapshot).toMatchObject({
      doctype: "File",
      name: "file_object",
      data: {
        filename: "invoice.pdf",
        key: "acme/files/file_object-invoice.pdf",
        content_type: "application/pdf",
        size: 5,
        is_private: false,
        uploaded_by: "owner@example.com",
        uploaded_at: now
      }
    });
    await expect(new Response((await services.storage.get("acme/files/file_object-invoice.pdf"))?.body).text()).resolves.toBe(
      "hello"
    );
  });

  it("enforces File permissions when downloading private files", async () => {
    const services = createFileServices();
    const uploaded = await services.files.upload({
      actor: owner,
      filename: "private.txt",
      body: "secret",
      contentType: "text/plain"
    });

    await expect(services.files.download({ actor: guest, name: uploaded.snapshot.name })).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
    await expect(services.files.download({ actor: owner, name: uploaded.snapshot.name })).resolves.toMatchObject({
      snapshot: { name: uploaded.snapshot.name }
    });
  });

  it("deletes metadata and object content together", async () => {
    const services = createFileServices(["create", "request-delete", "delete"]);
    const uploaded = await services.files.upload({
      actor: owner,
      filename: "delete-me.txt",
      body: "bye"
    });

    await expect(
      services.files.delete({ actor: owner, name: uploaded.snapshot.name, expectedVersion: 1 })
    ).resolves.toMatchObject({ docstatus: "deleted", version: 3 });
    expect(services.storage.has("acme/files/file_object-delete-me.txt")).toBe(false);
  });

  it("does not write objects when metadata preflight fails", async () => {
    const store = new InMemoryDocumentStore();
    const storage = new InMemoryFileStorage();
    const registry = createRegistry();
    const files = new FileService({
      documents: new DocumentService({
        registry,
        store,
        clock: fixedClock(now),
        ids: deterministicIds(["meta", "event"])
      }),
      queries: new QueryService({ registry, projections: store }),
      storage,
      registry,
      clock: fixedClock(now),
      ids: deterministicIds(["object"])
    });

    await expect(files.upload({ actor: owner, filename: "orphan.txt", body: "oops" })).rejects.toMatchObject({
      code: "DOCTYPE_NOT_FOUND"
    });
    expect(storage.has("acme/files/file_object-orphan.txt")).toBe(false);
  });

  it("does not allow public readers to delete files they do not own", async () => {
    const services = createFileServices();
    const uploaded = await services.files.upload({
      actor: owner,
      filename: "public.txt",
      body: "public",
      isPrivate: false
    });

    await expect(services.files.download({ actor: otherUser, name: uploaded.snapshot.name })).resolves.toMatchObject({
      snapshot: { name: uploaded.snapshot.name }
    });
    await expect(services.files.delete({ actor: otherUser, name: uploaded.snapshot.name })).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
    expect(services.storage.has("acme/files/file_object-public.txt")).toBe(true);
  });

  it("keeps metadata retryable when object deletion fails", async () => {
    const services = createFileServices(["create", "request-delete", "delete"]);
    const uploaded = await services.files.upload({
      actor: owner,
      filename: "sticky.txt",
      body: "sticky"
    });
    const failingFiles = new FileService({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      storage: new FailingDeleteStorage(services.storage),
      clock: fixedClock(now),
      ids: deterministicIds(["unused"])
    });

    await expect(failingFiles.delete({ actor: owner, name: uploaded.snapshot.name })).rejects.toThrow(
      "delete failed"
    );
    await expect(services.queries.getDocument(owner, "File", uploaded.snapshot.name)).resolves.toMatchObject({
      docstatus: "draft",
      version: 2,
      data: {
        storage_state: "delete_requested",
        deletion_requested_at: now
      }
    });
    await expect(services.files.download({ actor: owner, name: uploaded.snapshot.name })).rejects.toMatchObject({
      code: "DOCUMENT_DELETED",
      status: 410
    });
    await expect(
      services.files.delete({ actor: owner, name: uploaded.snapshot.name, expectedVersion: 1 })
    ).resolves.toMatchObject({ docstatus: "deleted", version: 3 });
    expect(services.storage.has("acme/files/file_object-sticky.txt")).toBe(false);
  });

  it("validates attachment targets before writing object content", async () => {
    const services = createFileServices();

    await expect(
      services.files.upload({
        actor: owner,
        filename: "dangling.txt",
        body: "dangling",
        attachedTo: { doctype: "File", name: "missing" }
      })
    ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    expect(services.storage.has("acme/files/file_object-dangling.txt")).toBe(false);
  });
});

function createFileServices(ids: readonly string[] = ["create"]) {
  const registry = createRegistry({ doctypes: [fileDocType] });
  const store = new InMemoryDocumentStore();
  const storage = new InMemoryFileStorage();
  const documents = new DocumentService({
    registry,
    store,
    clock: fixedClock(now),
    ids: deterministicIds(ids)
  });
  const queries = new QueryService({ registry, projections: store });
  const files = new FileService({
    registry,
    documents,
    queries,
    storage,
    clock: fixedClock(now),
    ids: deterministicIds(["object"])
  });
  return { registry, store, storage, documents, queries, files };
}

class FailingDeleteStorage implements FileStorage {
  constructor(private readonly storage: FileStorage) {}

  put(command: PutFileObjectCommand) {
    return this.storage.put(command);
  }

  get(key: string) {
    return this.storage.get(key);
  }

  async delete(): Promise<void> {
    throw new Error("delete failed");
  }
}
