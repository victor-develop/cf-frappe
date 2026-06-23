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
import { MIN_MULTIPART_FILE_PART_BYTES } from "../../src";
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

  it("previews browser-safe files inline through the file API", async () => {
    const app = makeApp(1024, ["create-1", "create-2"], ["object-1", "object-2"]);
    const textUpload = await app.request("/api/files?filename=preview.txt&is_private=false", {
      method: "POST",
      headers: userHeaders("owner@example.com", "User"),
      body: "preview me"
    });
    expect(textUpload.status).toBe(201);
    const htmlUpload = await app.request("/api/files?filename=inline.html&is_private=false", {
      method: "POST",
      headers: { ...userHeaders("owner@example.com", "User"), "content-type": "text/html" },
      body: "<script>alert(1)</script>"
    });
    expect(htmlUpload.status).toBe(201);

    const listed = await app.request("/api/files?limit=10", {
      headers: userHeaders("guest", "Guest")
    });
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      data: {
        files: expect.arrayContaining([
          expect.objectContaining({ filename: "preview.txt", previewable: true }),
          expect.objectContaining({ filename: "inline.html", previewable: false })
        ])
      }
    });

    const preview = await app.request("/api/files/file_object-1/preview", {
      headers: userHeaders("guest", "Guest")
    });
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-disposition")).toBe('inline; filename="preview.txt"');
    expect(preview.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(preview.text()).resolves.toBe("preview me");

    const unsupported = await app.request("/api/files/file_object-2/preview", {
      headers: userHeaders("guest", "Guest")
    });
    expect(unsupported.status).toBe(400);
    await expect(unsupported.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "File 'file_object-2' cannot be previewed" }
    });
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

    const updated = await app.request("/api/resource/File/file_object", {
      method: "PUT",
      headers: {
        ...userHeaders("owner@example.com", "User"),
        "content-type": "application/json"
      },
      body: JSON.stringify({ filename: "bypass.txt", expectedVersion: 1 })
    });
    expect(updated.status).toBe(403);
    await expect(updated.json()).resolves.toMatchObject({
      error: {
        code: "PERMISSION_DENIED",
        message: "Actor 'owner@example.com' cannot update File/file_object"
      }
    });

    const commanded = await app.request("/api/resource/File/file_object/command/updateMetadata", {
      method: "POST",
      headers: {
        ...userHeaders("owner@example.com", "User"),
        "content-type": "application/json"
      },
      body: JSON.stringify({ filename: "bypass.txt", expectedVersion: 1 })
    });
    expect(commanded.status).toBe(400);
    await expect(commanded.json()).resolves.toMatchObject({
      error: {
        code: "BAD_REQUEST",
        message: "File command 'updateMetadata' is internal"
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

    const filteredList = await app.request(
      "/api/files?limit=5&filename=private&content_type=text/plain&uploaded_by=owner%40example.com&storage_state=available&is_private=true",
      {
        headers: userHeaders("owner@example.com", "User")
      }
    );
    expect(filteredList.status).toBe(200);
    await expect(filteredList.json()).resolves.toMatchObject({
      data: {
        limit: 5,
        filters: {
          filename: "private",
          contentType: "text/plain",
          uploadedBy: "owner@example.com",
          storageState: "available",
          isPrivate: true
        },
        files: [
          {
            name: "file_object-2",
            filename: "private.txt",
            isPrivate: true
          }
        ]
      }
    });

    const scanFilteredList = await app.request("/api/files?scan_status=clean", {
      headers: userHeaders("owner@example.com", "User")
    });
    expect(scanFilteredList.status).toBe(200);
    await expect(scanFilteredList.json()).resolves.toMatchObject({
      data: {
        filters: { scanStatus: "clean" },
        files: []
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

    const badPrivacy = await app.request("/api/files?is_private=maybe", {
      headers: userHeaders("owner@example.com", "User")
    });
    expect(badPrivacy.status).toBe(400);
    await expect(badPrivacy.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Expected boolean query parameter" }
    });
  });

  it("updates file metadata through the file API", async () => {
    const app = makeApp(1024, ["create-1", "create-2", "metadata-1"], ["object-1", "object-2"]);
    await app.request("/api/files?filename=target.txt&is_private=false", {
      method: "POST",
      headers: userHeaders("owner@example.com", "User"),
      body: "target"
    });
    await app.request("/api/files?filename=private.txt", {
      method: "POST",
      headers: userHeaders("owner@example.com", "User"),
      body: "secret"
    });

    const updated = await app.request("/api/files/file_object-2", {
      method: "PATCH",
      headers: {
        ...userHeaders("owner@example.com", "User"),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        filename: "renamed.txt",
        is_private: false,
        attached_to_doctype: "File",
        attached_to_name: "file_object-1",
        expectedVersion: 1
      })
    });

    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      data: {
        name: "file_object-2",
        version: 2,
        data: {
          filename: "renamed.txt",
          key: "acme/files/file_object-2-private.txt",
          is_private: false,
          attached_to_doctype: "File",
          attached_to_name: "file_object-1"
        }
      }
    });

    const guestDownload = await app.request("/api/files/file_object-2/content", {
      headers: userHeaders("guest", "Guest")
    });
    expect(guestDownload.status).toBe(200);
    expect(guestDownload.headers.get("content-disposition")).toBe('attachment; filename="renamed.txt"');

    const guestList = await app.request("/api/files?attached_to_doctype=File&attached_to_name=file_object-1", {
      headers: userHeaders("guest", "Guest")
    });
    expect(guestList.status).toBe(200);
    await expect(guestList.json()).resolves.toMatchObject({
      data: {
        files: [
          {
            name: "file_object-2",
            filename: "renamed.txt",
            editable: false,
            deletable: false
          }
        ]
      }
    });
  });

  it("bulk deletes files through the file API with per-file outcomes", async () => {
    const { app, storage } = makeAppFixture(
      1024,
      ["create-1", "create-2", "request-delete-1", "delete-1"],
      ["object-1", "object-2"]
    );
    await app.request("/api/files?filename=selected.txt", {
      method: "POST",
      headers: userHeaders("owner@example.com", "User"),
      body: "selected"
    });
    await app.request("/api/files?filename=stale.txt", {
      method: "POST",
      headers: userHeaders("owner@example.com", "User"),
      body: "stale"
    });

    const response = await app.request("/api/files/delete", {
      method: "POST",
      headers: jsonHeaders("owner@example.com", "User"),
      body: JSON.stringify({
        files: [
          { name: "file_object-1", expectedVersion: 1 },
          { name: "file_object-2", expectedVersion: 99 }
        ]
      })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        deleted: [
          {
            name: "file_object-1",
            snapshot: { docstatus: "deleted", version: 3 }
          }
        ],
        failed: [
          {
            name: "file_object-2",
            code: "DOCUMENT_CONFLICT",
            status: 409,
            message: "Expected version 99, found 1"
          }
        ]
      }
    });
    expect(storage.has("acme/files/file_object-1-selected.txt")).toBe(false);
    expect(storage.has("acme/files/file_object-2-stale.txt")).toBe(true);

    const invalid = await app.request("/api/files/delete", {
      method: "POST",
      headers: jsonHeaders("owner@example.com", "User"),
      body: JSON.stringify({ files: [] })
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "At least one file must be selected" }
    });
  });

  it("bulk updates file metadata through the file API with per-file outcomes", async () => {
    const { app } = makeAppFixture(
      1024,
      ["create-target", "create-selected", "create-stale", "metadata-selected"],
      ["target", "selected", "stale"]
    );
    await app.request("/api/files?filename=target.txt&is_private=false", {
      method: "POST",
      headers: userHeaders("owner@example.com", "User"),
      body: "target"
    });
    await app.request("/api/files?filename=selected.txt", {
      method: "POST",
      headers: userHeaders("owner@example.com", "User"),
      body: "selected"
    });
    await app.request("/api/files?filename=stale.txt", {
      method: "POST",
      headers: userHeaders("owner@example.com", "User"),
      body: "stale"
    });

    const response = await app.request("/api/files/bulk-metadata", {
      method: "POST",
      headers: jsonHeaders("owner@example.com", "User"),
      body: JSON.stringify({
        files: [
          { name: "file_selected", expectedVersion: 1 },
          { name: "file_stale", expectedVersion: 99 }
        ],
        is_private: false,
        attached_to_doctype: "File",
        attached_to_name: "file_target"
      })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        updated: [
          {
            name: "file_selected",
            snapshot: {
              version: 2,
              data: {
                filename: "selected.txt",
                is_private: false,
                attached_to_doctype: "File",
                attached_to_name: "file_target"
              }
            }
          }
        ],
        failed: [
          {
            name: "file_stale",
            code: "DOCUMENT_CONFLICT",
            status: 409,
            message: "Expected version 99, found 1"
          }
        ]
      }
    });

    const guestList = await app.request("/api/files?attached_to_doctype=File&attached_to_name=file_target", {
      headers: userHeaders("guest", "Guest")
    });
    expect(guestList.status).toBe(200);
    await expect(guestList.json()).resolves.toMatchObject({
      data: {
        files: [
          {
            name: "file_selected",
            filename: "selected.txt",
            isPrivate: false,
            attachedTo: { doctype: "File", name: "file_target" }
          }
        ]
      }
    });

    const invalid = await app.request("/api/files/bulk-metadata", {
      method: "POST",
      headers: jsonHeaders("owner@example.com", "User"),
      body: JSON.stringify({ files: [{ name: "file_selected", expectedVersion: 2 }] })
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "At least one file metadata field must be provided" }
    });
  });

  it("reserves and completes direct uploads through the file API", async () => {
    const { app, storage } = makeAppFixture(1024, ["reserve", "finalize"], ["direct"]);

    const prepared = await app.request("/api/files/direct-upload", {
      method: "POST",
      headers: jsonHeaders("owner@example.com", "User"),
      body: JSON.stringify({
        filename: "browser.txt",
        size: 5,
        content_type: "text/plain",
        is_private: false,
        expiresInSeconds: 60
      })
    });

    expect(prepared.status).toBe(201);
    const preparedBody = await prepared.json() as {
      data: { readonly name: string; readonly version: number; readonly data: { readonly key: string } };
      upload: { readonly method: string; readonly url: string; readonly headers: Record<string, string> };
    };
    expect(preparedBody).toMatchObject({
      data: {
        name: "file_direct",
        version: 1,
        data: {
          filename: "browser.txt",
          key: "acme/files/file_direct-browser.txt",
          content_type: "text/plain",
          size: 5,
          is_private: false,
          storage_state: "upload_pending",
          direct_upload_expires_at: "2026-01-01T00:01:00.000Z"
        }
      },
      upload: {
        method: "PUT",
        url: "memory://file-storage/acme%2Ffiles%2Ffile_direct-browser.txt",
        headers: {
          "content-type": "text/plain",
          "content-length": "5"
        }
      }
    });

    const pendingDownload = await app.request("/api/files/file_direct/content", {
      headers: userHeaders("owner@example.com", "User")
    });
    expect(pendingDownload.status).toBe(409);
    await expect(pendingDownload.json()).resolves.toMatchObject({
      error: { code: "FILE_UPLOAD_PENDING" }
    });

    await storage.put({
      key: preparedBody.data.data.key,
      body: "hello",
      contentType: "text/plain",
      filename: "browser.txt",
      size: 5
    });

    const completed = await app.request("/api/files/file_direct/complete-upload", {
      method: "POST",
      headers: jsonHeaders("owner@example.com", "User"),
      body: JSON.stringify({ expectedVersion: preparedBody.data.version })
    });

    expect(completed.status).toBe(200);
    await expect(completed.json()).resolves.toMatchObject({
      data: {
        name: "file_direct",
        version: 2,
        data: {
          storage_state: "available",
          etag: '"memory-acme/files/file_direct-browser.txt-5"'
        }
      }
    });
    const downloaded = await app.request("/api/files/file_direct/content", {
      headers: userHeaders("guest", "Guest")
    });
    expect(downloaded.status).toBe(200);
    await expect(downloaded.text()).resolves.toBe("hello");
  });

  it("reserves, uploads parts, and completes multipart uploads through the file API", async () => {
    const { app } = makeAppFixture(
      MIN_MULTIPART_FILE_PART_BYTES + 16,
      ["reserve", "part-1", "part-2", "begin", "complete"],
      ["multipart"]
    );
    const firstPart = repeatedBytes("a", MIN_MULTIPART_FILE_PART_BYTES);

    const prepared = await app.request("/api/files/multipart-upload", {
      method: "POST",
      headers: jsonHeaders("owner@example.com", "User"),
      body: JSON.stringify({
        filename: "large.txt",
        size: MIN_MULTIPART_FILE_PART_BYTES + 4,
        content_type: "text/plain",
        is_private: false
      })
    });

    expect(prepared.status).toBe(201);
    const preparedBody = await prepared.json() as {
      data: { readonly name: string; readonly version: number };
      upload: { readonly uploadId: string };
    };
    expect(preparedBody).toMatchObject({
      data: {
        name: "file_multipart",
        version: 1,
        data: {
          storage_state: "upload_pending",
          multipart_upload_id: "memory-multipart-1"
        }
      },
      upload: { uploadId: "memory-multipart-1" }
    });

    const first = await app.request("/api/files/file_multipart/multipart-parts/1", {
      method: "PUT",
      headers: {
        ...userHeaders("owner@example.com", "User"),
        "content-length": String(firstPart.byteLength)
      },
      body: new Blob([firstPart])
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as {
      part: { readonly partNumber: number; readonly etag: string };
      data: { readonly version: number };
    };
    expect(firstBody).toMatchObject({
      part: { partNumber: 1 },
      data: {
        version: 2,
        data: {
          multipart_parts: [{ partNumber: 1, size: MIN_MULTIPART_FILE_PART_BYTES }]
        }
      }
    });
    const second = await app.request("/api/files/file_multipart/multipart-parts/2", {
      method: "PUT",
      headers: {
        ...userHeaders("owner@example.com", "User"),
        "content-length": "4"
      },
      body: "tail"
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json() as {
      part: { readonly partNumber: number; readonly etag: string };
      data: { readonly version: number };
    };

    const completed = await app.request("/api/files/file_multipart/complete-multipart-upload", {
      method: "POST",
      headers: jsonHeaders("owner@example.com", "User"),
      body: JSON.stringify({
        expectedVersion: secondBody.data.version,
        parts: [secondBody.part, firstBody.part]
      })
    });

    expect(completed.status).toBe(200);
    await expect(completed.json()).resolves.toMatchObject({
      data: {
        name: "file_multipart",
        version: 5,
        data: {
          storage_state: "available"
        }
      }
    });
    const downloaded = await app.request("/api/files/file_multipart/content", {
      headers: userHeaders("guest", "Guest")
    });
    expect(downloaded.status).toBe(200);
    const bytes = new Uint8Array(await downloaded.arrayBuffer());
    expect(bytes.byteLength).toBe(MIN_MULTIPART_FILE_PART_BYTES + 4);
    expect(new TextDecoder().decode(bytes.slice(MIN_MULTIPART_FILE_PART_BYTES))).toBe("tail");
  });

  it("requires content-length for streamed multipart part uploads", async () => {
    const app = makeApp(MIN_MULTIPART_FILE_PART_BYTES + 16, ["reserve"], ["multipart"]);
    const prepared = await app.request("/api/files/multipart-upload", {
      method: "POST",
      headers: jsonHeaders("owner@example.com", "User"),
      body: JSON.stringify({
        filename: "large.txt",
        size: MIN_MULTIPART_FILE_PART_BYTES + 4
      })
    });
    expect(prepared.status).toBe(201);

    const uploaded = await app.request("/api/files/file_multipart/multipart-parts/1", {
      method: "PUT",
      headers: userHeaders("owner@example.com", "User"),
      body: "tail"
    });

    expect(uploaded.status).toBe(400);
    await expect(uploaded.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "Multipart upload part size is required for streamed bodies" }
    });
  });

  it("validates multipart upload completion bodies", async () => {
    const app = makeApp(MIN_MULTIPART_FILE_PART_BYTES + 16, ["reserve"], ["multipart"]);
    const prepared = await app.request("/api/files/multipart-upload", {
      method: "POST",
      headers: jsonHeaders("owner@example.com", "User"),
      body: JSON.stringify({
        filename: "large.txt",
        size: MIN_MULTIPART_FILE_PART_BYTES + 4
      })
    });
    expect(prepared.status).toBe(201);

    const completed = await app.request("/api/files/file_multipart/complete-multipart-upload", {
      method: "POST",
      headers: jsonHeaders("owner@example.com", "User"),
      body: JSON.stringify({ parts: [{ partNumber: 1 }] })
    });

    expect(completed.status).toBe(400);
    await expect(completed.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "parts[0].etag must be a string" }
    });
  });

  it("validates direct upload reservation bodies", async () => {
    const app = makeApp();

    const response = await app.request("/api/files/direct-upload", {
      method: "POST",
      headers: jsonHeaders("owner@example.com", "User"),
      body: JSON.stringify({ filename: "missing-size.txt" })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "size must be a non-negative integer" }
    });
  });
});

function makeApp(
  maxFileBytes = 1024,
  documentIds: readonly string[] = ["create"],
  fileIds: readonly string[] = ["object"]
) {
  return makeAppFixture(maxFileBytes, documentIds, fileIds).app;
}

function makeAppFixture(
  maxFileBytes = 1024,
  documentIds: readonly string[] = ["create"],
  fileIds: readonly string[] = ["object"]
) {
  const registry = createRegistry({ doctypes: [fileDocType] });
  const store = new InMemoryDocumentStore();
  const storage = new InMemoryFileStorage();
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
    storage,
    clock: fixedClock(now),
    ids: deterministicIds(fileIds),
    maxFileBytes
  });
  const app = createResourceApi({
    registry,
    documents,
    queries,
    actor: unsafeHeaderActorResolver,
    files,
    maxFileBytes
  });
  return { app, storage };
}

function userHeaders(user: string, roles: string): HeadersInit {
  return {
    "content-type": "text/plain;charset=UTF-8",
    "x-cf-frappe-user": user,
    "x-cf-frappe-roles": roles,
    "x-cf-frappe-tenant": "acme"
  };
}

function jsonHeaders(user: string, roles: string): HeadersInit {
  return {
    ...userHeaders(user, roles),
    "content-type": "application/json"
  };
}

function repeatedBytes(value: string, size: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(size).fill(new TextEncoder().encode(value)[0] ?? 0);
}
