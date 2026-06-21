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
});

function makeApp(maxFileBytes = 1024) {
  const registry = createRegistry({ doctypes: [fileDocType] });
  const store = new InMemoryDocumentStore();
  const documents = new DocumentService({
    registry,
    store,
    clock: fixedClock(now),
    ids: deterministicIds(["create"])
  });
  const queries = new QueryService({ registry, projections: store });
  const files = new FileService({
    registry,
    documents,
    queries,
    storage: new InMemoryFileStorage(),
    clock: fixedClock(now),
    ids: deterministicIds(["object"]),
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
