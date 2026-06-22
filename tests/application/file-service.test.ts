import {
  createRegistry,
  deterministicIds,
  DocumentService,
  fileDocType,
  FileService,
  fixedClock,
  InMemoryDocumentStore,
  InMemoryFileStorage,
  ModelBackedUserPermissionGrantValidator,
  QueryService,
  UserPermissionService
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

  it("lists readable file metadata with attachment filters", async () => {
    const services = createFileServices(
      ["create-1", "create-2", "create-3"],
      ["object-1", "object-2", "object-3"]
    );
    const publicFile = await services.files.upload({
      actor: otherUser,
      filename: "public.txt",
      body: "public",
      isPrivate: false
    });
    await services.files.upload({
      actor: otherUser,
      filename: "private-other.txt",
      body: "private"
    });
    const attached = await services.files.upload({
      actor: owner,
      filename: "attached.txt",
      body: "attached",
      attachedTo: { doctype: "File", name: publicFile.snapshot.name }
    });

    const dashboard = await services.files.dashboard(owner);
    expect(dashboard).toMatchObject({ limit: 50, filters: {} });
    expect(dashboard.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: attached.snapshot.name,
          filename: "attached.txt",
          attachedTo: { doctype: "File", name: publicFile.snapshot.name },
          deletable: true
        }),
        expect.objectContaining({
          name: publicFile.snapshot.name,
          filename: "public.txt",
          deletable: false
        })
      ])
    );
    expect(dashboard.files).toHaveLength(2);
    await expect(
      services.files.dashboard(owner, {
        attachedToDoctype: "File",
        attachedToName: publicFile.snapshot.name,
        limit: 10
      })
    ).resolves.toMatchObject({
      files: [{ name: attached.snapshot.name, deletable: true }],
      limit: 10,
      filters: { attachedToDoctype: "File", attachedToName: publicFile.snapshot.name }
    });
  });

  it("over-fetches permissioned file dashboard pages until the readable limit is filled", async () => {
    const services = createFileServices(
      ["create-1", "create-2", "create-3"],
      ["object-1", "object-2", "object-3"]
    );
    await services.files.upload({
      actor: otherUser,
      filename: "private-first.txt",
      body: "private"
    });
    const visibleOne = await services.files.upload({
      actor: otherUser,
      filename: "public-one.txt",
      body: "one",
      isPrivate: false
    });
    const visibleTwo = await services.files.upload({
      actor: owner,
      filename: "owned-two.txt",
      body: "two"
    });

    await expect(services.files.dashboard(owner, { limit: 2 })).resolves.toMatchObject({
      files: [
        { name: visibleOne.snapshot.name, filename: "public-one.txt" },
        { name: visibleTwo.snapshot.name, filename: "owned-two.txt" }
      ],
      limit: 2
    });
  });

  it("applies event-sourced user permissions to file dashboard metadata", async () => {
    const services = createFileServices(["create-1", "create-2"], ["object-1", "object-2"]);
    const admin = { id: "admin@example.com", roles: ["System Manager"], tenantId: "acme" };
    const allowed = await services.files.upload({
      actor: otherUser,
      filename: "allowed.txt",
      body: "allowed",
      isPrivate: false
    });
    await services.files.upload({
      actor: otherUser,
      filename: "denied.txt",
      body: "denied",
      isPrivate: false
    });
    await services.userPermissions.allow({
      actor: admin,
      userId: owner.id,
      targetDoctype: "File",
      targetName: allowed.snapshot.name
    });

    await expect(services.files.dashboard(owner)).resolves.toMatchObject({
      files: [{ name: allowed.snapshot.name, filename: "allowed.txt" }]
    });
  });

  it("updates file metadata through an event-sourced command", async () => {
    const services = createFileServices(
      ["create-1", "create-2", "metadata-1"],
      ["object-1", "object-2"]
    );
    const target = await services.files.upload({
      actor: owner,
      filename: "target.txt",
      body: "target",
      isPrivate: false
    });
    const uploaded = await services.files.upload({
      actor: owner,
      filename: "original.txt",
      body: "content"
    });

    const updated = await services.files.updateMetadata({
      actor: owner,
      name: uploaded.snapshot.name,
      filename: "renamed/final.txt",
      isPrivate: false,
      attachedTo: { doctype: "File", name: target.snapshot.name },
      expectedVersion: 1
    });

    expect(updated).toMatchObject({
      name: uploaded.snapshot.name,
      version: 2,
      data: {
        filename: "renamed-final.txt",
        key: "acme/files/file_object-2-original.txt",
        is_private: false,
        attached_to_doctype: "File",
        attached_to_name: target.snapshot.name
      }
    });
    expect(services.storage.has("acme/files/file_object-2-original.txt")).toBe(true);
    await expect(
      services.files.dashboard(owner, {
        attachedToDoctype: "File",
        attachedToName: target.snapshot.name
      })
    ).resolves.toMatchObject({
      files: [
        {
          name: uploaded.snapshot.name,
          filename: "renamed-final.txt",
          editable: true,
          deletable: true,
          attachedTo: { doctype: "File", name: target.snapshot.name }
        }
      ]
    });
    await expect(services.files.download({ actor: guest, name: uploaded.snapshot.name })).resolves.toMatchObject({
      snapshot: { data: { filename: "renamed-final.txt", is_private: false } }
    });
  });

  it("validates metadata attachment targets before appending file metadata events", async () => {
    const services = createFileServices(["create-1", "metadata-1"], ["object-1"]);
    const uploaded = await services.files.upload({
      actor: owner,
      filename: "original.txt",
      body: "content"
    });

    await expect(
      services.files.updateMetadata({
        actor: owner,
        name: uploaded.snapshot.name,
        attachedTo: { doctype: "File", name: "missing" },
        expectedVersion: 1
      })
    ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    const current = await services.queries.getDocument(owner, "File", uploaded.snapshot.name);
    expect(current).toMatchObject({
      version: 1,
      data: { filename: "original.txt" }
    });
    expect(current.data).not.toHaveProperty("attached_to_doctype");
    expect(current.data).not.toHaveProperty("attached_to_name");
  });

  it("denies metadata updates before validating requested attachment targets", async () => {
    const services = createFileServices(["create-1"], ["object-1"]);
    const uploaded = await services.files.upload({
      actor: otherUser,
      filename: "public.txt",
      body: "public",
      isPrivate: false
    });

    await expect(
      services.files.updateMetadata({
        actor: owner,
        name: uploaded.snapshot.name,
        attachedTo: { doctype: "File", name: "missing" }
      })
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: `Actor '${owner.id}' cannot execute updateMetadata on File/${uploaded.snapshot.name}`
    });
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

function createFileServices(ids: readonly string[] = ["create"], fileIds: readonly string[] = ["object"]) {
  const registry = createRegistry({ doctypes: [fileDocType] });
  const store = new InMemoryDocumentStore();
  const storage = new InMemoryFileStorage();
  const userPermissions = new UserPermissionService({
    events: store,
    clock: fixedClock(now),
    ids: deterministicIds(["user-permission-event-1", "user-permission-event-2", "user-permission-event-3"]),
    validator: new ModelBackedUserPermissionGrantValidator({ registry, events: store })
  });
  const documents = new DocumentService({
    registry,
    store,
    userPermissions,
    clock: fixedClock(now),
    ids: deterministicIds(ids)
  });
  const queries = new QueryService({ registry, projections: store, userPermissions });
  const files = new FileService({
    registry,
    documents,
    queries,
    storage,
    clock: fixedClock(now),
    ids: deterministicIds(fileIds)
  });
  return { registry, store, storage, documents, queries, userPermissions, files };
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
