import {
  createRegistry,
  createResourceApi,
  deterministicIds,
  DocumentService,
  fileDocType,
  FileService,
  fixedClock,
  InMemoryDocumentStore,
  InMemoryFileStorage,
  QueryService,
  unsafeHeaderActorResolver
} from "../../src";
import { now } from "../helpers";

describe("file api", () => {
  it("uploads and downloads file content through /api/files", async () => {
    const app = makeApp();

    const uploaded = await app.request("/api/files?filename=hello.txt&is_private=false", {
      method: "POST",
      headers: userHeaders("owner@example.com", "User"),
      body: "hello"
    });
    expect(uploaded.status).toBe(201);
    await expect(uploaded.json()).resolves.toMatchObject({
      data: {
        doctype: "File",
        name: "file_object",
        data: {
          filename: "hello.txt",
          content_type: "text/plain;charset=UTF-8",
          size: 5,
          is_private: false
        }
      }
    });

    const downloaded = await app.request("/api/files/file_object/content", {
      headers: userHeaders("guest", "Guest")
    });
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toBe("text/plain;charset=UTF-8");
    expect(downloaded.headers.get("etag")).toBe('"memory-acme/files/file_object-hello.txt-5"');
    await expect(downloaded.text()).resolves.toBe("hello");
  });

  it("rejects oversized uploads before storing content", async () => {
    const app = makeApp(4);

    const response = await app.request("/api/files?filename=too-big.txt", {
      method: "POST",
      headers: userHeaders("owner@example.com", "User"),
      body: "hello"
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "File exceeds 4 bytes" }
    });
  });

  it("does not expose File counts through the generic resource list", async () => {
    const app = makeApp();
    const uploaded = await app.request("/api/files?filename=private.txt", {
      method: "POST",
      headers: userHeaders("owner@example.com", "User"),
      body: "secret"
    });
    expect(uploaded.status).toBe(201);

    const listed = await app.request("/api/resource/File", {
      headers: userHeaders("owner@example.com", "User")
    });

    expect(listed.status).toBe(403);
    await expect(listed.json()).resolves.toMatchObject({
      error: {
        code: "PERMISSION_DENIED",
        message: "Actor 'owner@example.com' cannot read File"
      }
    });
  });

  it("lists readable file metadata through the file dashboard endpoint", async () => {
    const app = makeApp(1024, ["create-1", "create-2"], ["object-1", "object-2"]);
    const publicUpload = await app.request("/api/files?filename=public.txt&is_private=false", {
      method: "POST",
      headers: userHeaders("owner@example.com", "User"),
      body: "public"
    });
    expect(publicUpload.status).toBe(201);
    const privateUpload = await app.request(
      "/api/files?filename=private.txt&attached_to_doctype=File&attached_to_name=file_object-1",
      {
        method: "POST",
        headers: userHeaders("owner@example.com", "User"),
        body: "private"
      }
    );
    expect(privateUpload.status).toBe(201);

    const ownerList = await app.request("/api/files?limit=10&attached_to_doctype=File&attached_to_name=file_object-1", {
      headers: userHeaders("owner@example.com", "User")
    });

    expect(ownerList.status).toBe(200);
    await expect(ownerList.json()).resolves.toMatchObject({
      data: {
        limit: 10,
        filters: {
          attachedToDoctype: "File",
          attachedToName: "file_object-1"
        },
        files: [
          {
            name: "file_object-2",
            filename: "private.txt",
            contentType: "text/plain;charset=UTF-8",
            size: 7,
            isPrivate: true,
            uploadedBy: "owner@example.com",
            uploadedAt: now,
            expectedVersion: 1,
            deletable: true,
            attachedTo: { doctype: "File", name: "file_object-1" }
          }
        ]
      }
    });

    const guestList = await app.request("/api/files?limit=10", {
      headers: userHeaders("guest", "Guest")
    });
    expect(guestList.status).toBe(200);
    const guestBody = await guestList.json() as { data: { files: readonly unknown[] } };
    expect(guestBody).toMatchObject({
      data: {
        files: [
          {
            filename: "public.txt",
            isPrivate: false,
            deletable: false
          }
        ]
      }
    });
    expect(guestBody.data.files).toHaveLength(1);

    const badLimit = await app.request("/api/files?limit=0", {
      headers: userHeaders("owner@example.com", "User")
    });
    expect(badLimit.status).toBe(400);
    await expect(badLimit.json()).resolves.toMatchObject({
      error: { message: "File dashboard limit must be between 1 and 200" }
    });
  });
});

function makeApp(
  maxFileBytes = 1024,
  documentIds: readonly string[] = ["create"],
  fileIds: readonly string[] = ["object"]
) {
  const registry = createRegistry({ doctypes: [fileDocType] });
  const store = new InMemoryDocumentStore();
  const documents = new DocumentService({
    registry,
    store,
    clock: fixedClock(now),
    ids: deterministicIds(documentIds)
  });
  const queries = new QueryService({ registry, projections: store });
  const files = new FileService({
    registry,
    documents,
    queries,
    storage: new InMemoryFileStorage(),
    clock: fixedClock(now),
    ids: deterministicIds(fileIds),
    maxFileBytes
  });
  return createResourceApi({
    registry,
    documents,
    queries,
    actor: unsafeHeaderActorResolver,
    files,
    maxFileBytes
  });
}

function userHeaders(user: string, roles: string): HeadersInit {
  return {
    "content-type": "text/plain;charset=UTF-8",
    "x-cf-frappe-user": user,
    "x-cf-frappe-roles": roles,
    "x-cf-frappe-tenant": "acme"
  };
}
