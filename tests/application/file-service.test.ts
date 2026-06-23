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
  UserPermissionService,
  documentStream
} from "../../src";
import { MIN_MULTIPART_FILE_PART_BYTES } from "../../src";
import type {
  FileScanner,
  FileScanTarget,
  FileStorage,
  FileTransformer,
  PutFileObjectCommand,
  TransformFileObjectCommand
} from "../../src";
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

  it("records clean scanner results in event-sourced File metadata", async () => {
    const scanner = new StaticScanner("clean", { engine: "unit-av", message: "ok" });
    const services = createFileServices(["create"], ["object"], { scanner });

    const uploaded = await services.files.upload({
      actor: owner,
      filename: "clean.txt",
      body: "safe",
      contentType: "text/plain",
      isPrivate: false
    });

    expect(scanner.targets).toEqual([
      expect.objectContaining({
        key: "acme/files/file_object-clean.txt",
        filename: "clean.txt",
        size: 4,
        contentType: "text/plain",
        source: "buffered_upload",
        actorId: owner.id,
        tenantId: "acme"
      })
    ]);
    expect(uploaded.snapshot).toMatchObject({
      version: 1,
      data: {
        storage_state: "available",
        scan_status: "clean",
        scan_checked_at: now,
        scan_engine: "unit-av",
        scan_message: "ok"
      }
    });
    await expect(services.store.readStream(documentStream("acme", "File", "file_object"))).resolves.toMatchObject([
      {
        type: "FileCreated",
        payload: {
          kind: "DocumentCreated",
          data: {
            scan_status: "clean",
            scan_checked_at: now,
            scan_engine: "unit-av"
          }
        }
      }
    ]);
  });

  it("keeps an event-sourced scan-failed audit record and removes content for infected buffered uploads", async () => {
    const scanner = new StaticScanner("infected", { engine: "unit-av", message: "EICAR-Test-File" });
    const services = createFileServices(["create"], ["object"], { scanner });

    await expect(
      services.files.upload({
        actor: owner,
        filename: "infected.txt",
        body: "bad!",
        contentType: "text/plain",
        isPrivate: false
      })
    ).rejects.toMatchObject({
      code: "FILE_SCAN_FAILED",
      message: "File scan failed: EICAR-Test-File"
    });

    expect(services.storage.has("acme/files/file_object-infected.txt")).toBe(false);
    await expect(services.queries.getDocument(owner, "File", "file_object")).resolves.toMatchObject({
      version: 1,
      data: {
        filename: "infected.txt",
        storage_state: "scan_failed",
        scan_status: "infected",
        scan_checked_at: now,
        scan_engine: "unit-av",
        scan_message: "EICAR-Test-File"
      }
    });
    await expect(services.files.download({ actor: owner, name: "file_object" })).rejects.toMatchObject({
      code: "FILE_SCAN_FAILED",
      status: 409
    });
    await expect(services.files.download({ actor: guest, name: "file_object" })).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
    await expect(services.store.readStream(documentStream("acme", "File", "file_object"))).resolves.toMatchObject([
      {
        type: "FileScanFailed",
        payload: {
          kind: "DocumentCreated",
          data: {
            storage_state: "scan_failed",
            scan_status: "infected"
          }
        }
      }
    ]);
  });

  it("removes buffered upload content when scanner adapters fail before metadata is created", async () => {
    const services = createFileServices(["create"], ["object"], {
      scanner: {
        async scan() {
          throw new Error("scanner unavailable");
        }
      }
    });

    await expect(
      services.files.upload({
        actor: owner,
        filename: "scanner-error.txt",
        body: "safe?",
        contentType: "text/plain"
      })
    ).rejects.toThrow("scanner unavailable");

    expect(services.storage.has("acme/files/file_object-scanner-error.txt")).toBe(false);
    await expect(services.store.readStream(documentStream("acme", "File", "file_object"))).resolves.toEqual([]);
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

  it("marks only available browser-safe file content as previewable", async () => {
    const services = createFileServices(
      ["create-1", "create-2", "create-3", "create-4"],
      ["object-1", "object-2", "object-3", "object-4"]
    );
    await services.files.upload({
      actor: owner,
      filename: "readme.txt",
      body: "hello",
      contentType: "text/plain",
      isPrivate: false
    });
    await services.files.upload({
      actor: owner,
      filename: "inline.html",
      body: "<script>alert(1)</script>",
      contentType: "text/html",
      isPrivate: false
    });
    await services.files.upload({
      actor: owner,
      filename: "logo.png",
      body: "png",
      contentType: "image/png",
      isPrivate: false
    });
    await services.files.upload({
      actor: owner,
      filename: "vector.svg",
      body: "<svg><script>alert(1)</script></svg>",
      contentType: "image/svg+xml",
      isPrivate: false
    });

    const dashboard = await services.files.dashboard(owner);

    expect(dashboard.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filename: "readme.txt", previewable: true }),
        expect.objectContaining({ filename: "inline.html", previewable: false }),
        expect.objectContaining({ filename: "logo.png", previewable: true }),
        expect.objectContaining({ filename: "vector.svg", previewable: false })
      ])
    );
  });

  it("filters readable file metadata by file manager fields", async () => {
    const scanner = new StaticScanner("clean", { engine: "unit-av" });
    const services = createFileServices(
      ["create-1", "create-2", "create-3", "reserve"],
      ["object-1", "object-2", "object-3", "direct"],
      { scanner }
    );
    const match = await services.files.upload({
      actor: owner,
      filename: "invoice-final.pdf",
      body: "final",
      contentType: "application/pdf",
      isPrivate: false
    });
    await services.files.upload({
      actor: owner,
      filename: "invoice-draft.txt",
      body: "draft",
      contentType: "text/plain"
    });
    await services.files.upload({
      actor: otherUser,
      filename: "invoice-final.pdf",
      body: "other",
      contentType: "application/pdf",
      isPrivate: false
    });
    const pending = await services.files.prepareDirectUpload({
      actor: owner,
      filename: "browser-upload.csv",
      size: 12,
      contentType: "text/csv",
      isPrivate: false
    });

    await expect(
      services.files.dashboard(owner, {
        filename: " FINAL ",
        contentType: " pdf ",
        uploadedBy: owner.id,
        storageState: " available ",
        scanStatus: " clean ",
        isPrivate: false,
        limit: 10
      })
    ).resolves.toMatchObject({
      files: [{ name: match.snapshot.name, filename: "invoice-final.pdf" }],
      limit: 10,
      filters: {
        filename: "FINAL",
        contentType: "pdf",
        uploadedBy: owner.id,
        storageState: "available",
        scanStatus: "clean",
        isPrivate: false
      }
    });

    await expect(
      services.files.dashboard(owner, {
        storageState: "upload_pending",
        scanStatus: "pending",
        isPrivate: false
      })
    ).resolves.toMatchObject({
      files: [{ name: pending.snapshot.name, filename: "browser-upload.csv" }],
      filters: {
        storageState: "upload_pending",
        scanStatus: "pending",
        isPrivate: false
      }
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

  it("bulk updates selected file metadata through the same event-sourced command path", async () => {
    const services = createFileServices(
      ["create-target", "create-selected", "create-stale", "metadata-selected"],
      ["target", "selected", "stale"]
    );
    const target = await services.files.upload({
      actor: owner,
      filename: "target.txt",
      body: "target",
      isPrivate: false
    });
    const selected = await services.files.upload({
      actor: owner,
      filename: "selected.txt",
      body: "selected"
    });
    const stale = await services.files.upload({
      actor: owner,
      filename: "stale.txt",
      body: "stale"
    });

    const result = await services.files.bulkUpdateMetadata({
      actor: owner,
      files: [
        { name: selected.snapshot.name, expectedVersion: 1 },
        { name: stale.snapshot.name, expectedVersion: 99 },
        { name: "missing" }
      ],
      isPrivate: false,
      attachedTo: { doctype: "File", name: target.snapshot.name }
    });

    expect(result).toMatchObject({
      updated: [
        {
          name: selected.snapshot.name,
          snapshot: {
            version: 2,
            data: {
              filename: "selected.txt",
              is_private: false,
              attached_to_doctype: "File",
              attached_to_name: target.snapshot.name
            }
          }
        }
      ],
      failed: [
        {
          name: stale.snapshot.name,
          code: "DOCUMENT_CONFLICT",
          status: 409,
          message: "Expected version 99, found 1"
        },
        {
          name: "missing",
          code: "DOCUMENT_NOT_FOUND",
          status: 404
        }
      ]
    });
    await expect(services.queries.getDocument(owner, "File", stale.snapshot.name)).resolves.toMatchObject({
      version: 1,
      data: { filename: "stale.txt", is_private: true }
    });
    await expect(services.store.readStream(documentStream("acme", "File", selected.snapshot.name))).resolves.toMatchObject([
      { type: "FileCreated" },
      {
        type: "FileMetadataUpdated",
        payload: {
          kind: "DomainCommandApplied",
          command: "updateMetadata",
          patch: {
            is_private: false,
            attached_to_doctype: "File",
            attached_to_name: target.snapshot.name
          }
        }
      }
    ]);
  });

  it("rejects bulk file metadata updates without a metadata patch before writing events", async () => {
    const services = createFileServices(["create"], ["object"]);
    const uploaded = await services.files.upload({
      actor: owner,
      filename: "keep.txt",
      body: "keep"
    });

    await expect(
      services.files.bulkUpdateMetadata({
        actor: owner,
        files: [{ name: uploaded.snapshot.name, expectedVersion: 1 }]
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "At least one file metadata field must be provided"
    });
    await expect(services.queries.getDocument(owner, "File", uploaded.snapshot.name)).resolves.toMatchObject({
      version: 1,
      data: { filename: "keep.txt" }
    });
  });

  it("reserves and finalizes direct browser uploads through event-sourced File metadata", async () => {
    const services = createFileServices(["reserve", "finalize"], ["direct"]);

    const prepared = await services.files.prepareDirectUpload({
      actor: owner,
      filename: "browser.pdf",
      size: 12,
      contentType: "application/pdf",
      isPrivate: false,
      expiresInSeconds: 60
    });

    expect(prepared).toMatchObject({
      snapshot: {
        doctype: "File",
        name: "file_direct",
        version: 1,
        data: {
          filename: "browser.pdf",
          key: "acme/files/file_direct-browser.pdf",
          content_type: "application/pdf",
          size: 12,
          is_private: false,
          uploaded_by: "owner@example.com",
          uploaded_at: now,
          storage_state: "upload_pending",
          direct_upload_expires_at: "2026-01-01T00:01:00.000Z"
        }
      },
      upload: {
        method: "PUT",
        key: "acme/files/file_direct-browser.pdf",
        url: "memory://file-storage/acme%2Ffiles%2Ffile_direct-browser.pdf",
        headers: {
          "content-type": "application/pdf",
          "content-length": "12"
        },
        expiresAt: "2026-01-01T00:01:00.000Z"
      }
    });
    await expect(services.files.download({ actor: owner, name: "file_direct" })).rejects.toMatchObject({
      code: "FILE_UPLOAD_PENDING",
      status: 409
    });
    await expect(services.files.download({ actor: guest, name: "file_direct" })).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
    await expect(services.files.dashboard(guest)).resolves.toMatchObject({ files: [] });

    await services.storage.put({
      key: "acme/files/file_direct-browser.pdf",
      body: "hello world!",
      contentType: "application/pdf",
      filename: "browser.pdf",
      size: 12
    });
    await expect(
      services.files.completeDirectUpload({ actor: owner, name: "file_direct", expectedVersion: 1 })
    ).resolves.toMatchObject({
      version: 2,
      data: {
        storage_state: "available",
        etag: '"memory-acme/files/file_direct-browser.pdf-12"'
      }
    });
    await expect(services.files.download({ actor: owner, name: "file_direct" })).resolves.toMatchObject({
      object: { metadata: { size: 12 } }
    });
    await expect(services.files.download({ actor: guest, name: "file_direct" })).resolves.toMatchObject({
      object: { metadata: { size: 12 } }
    });
    await expect(services.store.readStream(documentStream("acme", "File", "file_direct"))).resolves.toMatchObject([
      {
        type: "FileDirectUploadReserved",
        payload: {
          kind: "DocumentCreated",
          data: { storage_state: "upload_pending" }
        }
      },
      {
        type: "FileDirectUploadCompleted",
        payload: {
          kind: "DomainCommandApplied",
          command: "completeDirectUpload",
          patch: {
            storage_state: "available",
            etag: '"memory-acme/files/file_direct-browser.pdf-12"'
          }
        }
      }
    ]);
  });

  it("scans direct upload objects before making them available", async () => {
    const scanner = new StaticScanner("clean", { engine: "unit-av", message: "direct-ok" });
    const services = createFileServices(["reserve", "complete"], ["direct"], { scanner });

    const prepared = await services.files.prepareDirectUpload({
      actor: owner,
      filename: "direct-clean.txt",
      size: 5,
      contentType: "text/plain",
      isPrivate: false
    });

    expect(prepared.snapshot).toMatchObject({
      data: {
        storage_state: "upload_pending",
        scan_status: "pending"
      }
    });
    await services.storage.put({
      key: "acme/files/file_direct-direct-clean.txt",
      body: "hello",
      contentType: "text/plain",
      filename: "direct-clean.txt",
      size: 5
    });

    await expect(
      services.files.completeDirectUpload({
        actor: owner,
        name: prepared.snapshot.name,
        expectedVersion: prepared.snapshot.version
      })
    ).resolves.toMatchObject({
      version: 2,
      data: {
        storage_state: "available",
        scan_status: "clean",
        scan_checked_at: now,
        scan_engine: "unit-av",
        scan_message: "direct-ok"
      }
    });
    expect(scanner.targets).toEqual([
      expect.objectContaining({
        key: "acme/files/file_direct-direct-clean.txt",
        filename: "direct-clean.txt",
        source: "direct_upload",
        size: 5,
        contentType: "text/plain"
      })
    ]);
    await expect(services.store.readStream(documentStream("acme", "File", "file_direct"))).resolves.toMatchObject([
      { type: "FileDirectUploadReserved" },
      {
        type: "FileDirectUploadCompleted",
        payload: {
          kind: "DomainCommandApplied",
          patch: {
            storage_state: "available",
            scan_status: "clean",
            scan_checked_at: now
          }
        }
      }
    ]);
  });

  it("marks infected direct uploads as scan-failed without making content downloadable", async () => {
    const scanner = new StaticScanner("infected", { engine: "unit-av", message: "blocked" });
    const services = createFileServices(["reserve", "scan-failed"], ["direct"], { scanner });
    const prepared = await services.files.prepareDirectUpload({
      actor: owner,
      filename: "direct-bad.txt",
      size: 5,
      contentType: "text/plain",
      isPrivate: false
    });
    await services.storage.put({
      key: "acme/files/file_direct-direct-bad.txt",
      body: "hello",
      contentType: "text/plain",
      filename: "direct-bad.txt",
      size: 5
    });

    await expect(
      services.files.completeDirectUpload({
        actor: owner,
        name: prepared.snapshot.name,
        expectedVersion: prepared.snapshot.version
      })
    ).rejects.toMatchObject({
      code: "FILE_SCAN_FAILED",
      message: "File scan failed: blocked"
    });

    expect(services.storage.has("acme/files/file_direct-direct-bad.txt")).toBe(false);
    await expect(services.queries.getDocument(owner, "File", prepared.snapshot.name)).resolves.toMatchObject({
      version: 2,
      data: {
        storage_state: "scan_failed",
        scan_status: "infected",
        scan_checked_at: now,
        scan_engine: "unit-av",
        scan_message: "blocked"
      }
    });
    await expect(services.files.download({ actor: owner, name: prepared.snapshot.name })).rejects.toMatchObject({
      code: "FILE_SCAN_FAILED",
      status: 409
    });
    await expect(services.files.download({ actor: guest, name: prepared.snapshot.name })).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
  });

  it("keeps direct uploads pending for retry when scanner adapters fail", async () => {
    const services = createFileServices(["reserve"], ["direct"], {
      scanner: {
        async scan() {
          throw new Error("scanner unavailable");
        }
      }
    });
    const prepared = await services.files.prepareDirectUpload({
      actor: owner,
      filename: "direct-retry.txt",
      size: 5,
      contentType: "text/plain",
      isPrivate: false
    });
    await services.storage.put({
      key: "acme/files/file_direct-direct-retry.txt",
      body: "hello",
      contentType: "text/plain",
      filename: "direct-retry.txt",
      size: 5
    });

    await expect(
      services.files.completeDirectUpload({
        actor: owner,
        name: prepared.snapshot.name,
        expectedVersion: prepared.snapshot.version
      })
    ).rejects.toThrow("scanner unavailable");

    expect(services.storage.has("acme/files/file_direct-direct-retry.txt")).toBe(true);
    await expect(services.queries.getDocument(owner, "File", prepared.snapshot.name)).resolves.toMatchObject({
      version: 1,
      data: {
        storage_state: "upload_pending",
        scan_status: "pending"
      }
    });
    await expect(services.files.download({ actor: owner, name: prepared.snapshot.name })).rejects.toMatchObject({
      code: "FILE_UPLOAD_PENDING",
      status: 409
    });
    await expect(services.store.readStream(documentStream("acme", "File", "file_direct"))).resolves.toMatchObject([
      { type: "FileDirectUploadReserved" }
    ]);
  });

  it("keeps direct uploads pending when finalized object metadata does not match the reservation", async () => {
    const services = createFileServices(["reserve"], ["direct"]);
    const prepared = await services.files.prepareDirectUpload({
      actor: owner,
      filename: "mismatch.txt",
      size: 5,
      contentType: "text/plain"
    });

    await services.storage.put({
      key: "acme/files/file_direct-mismatch.txt",
      body: "too-large",
      contentType: "text/plain",
      filename: "mismatch.txt",
      size: 9
    });

    await expect(
      services.files.completeDirectUpload({
        actor: owner,
        name: prepared.snapshot.name,
        expectedVersion: prepared.snapshot.version
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Direct upload object size mismatch"
    });
    await expect(services.queries.getDocument(owner, "File", prepared.snapshot.name)).resolves.toMatchObject({
      version: 1,
      data: { storage_state: "upload_pending" }
    });
  });

  it("rejects same-size direct upload finalization when object content type differs from the reservation", async () => {
    const services = createFileServices(["reserve"], ["direct"]);
    const prepared = await services.files.prepareDirectUpload({
      actor: owner,
      filename: "same-size.txt",
      size: 5,
      contentType: "text/plain",
      isPrivate: false
    });

    await services.storage.put({
      key: "acme/files/file_direct-same-size.txt",
      body: "hello",
      contentType: "application/json",
      filename: "same-size.txt",
      size: 5
    });

    await expect(
      services.files.completeDirectUpload({
        actor: owner,
        name: prepared.snapshot.name,
        expectedVersion: prepared.snapshot.version
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Direct upload object content type mismatch"
    });
    await expect(services.queries.getDocument(owner, "File", prepared.snapshot.name)).resolves.toMatchObject({
      version: 1,
      data: {
        content_type: "text/plain",
        storage_state: "upload_pending"
      }
    });
    await expect(services.files.download({ actor: guest, name: prepared.snapshot.name })).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
  });

  it("reserves, uploads, and completes multipart files through event-sourced metadata", async () => {
    const services = createFileServices(["reserve", "part-1", "part-2", "begin", "complete"], ["multipart"]);
    const firstPart = repeatedBytes("a", MIN_MULTIPART_FILE_PART_BYTES);

    const prepared = await services.files.prepareMultipartUpload({
      actor: owner,
      filename: "large.bin",
      size: MIN_MULTIPART_FILE_PART_BYTES + 3,
      contentType: "application/octet-stream",
      isPrivate: false
    });

    expect(prepared).toMatchObject({
      snapshot: {
        doctype: "File",
        name: "file_multipart",
        version: 1,
        data: {
          filename: "large.bin",
          key: "acme/files/file_multipart-large.bin",
          content_type: "application/octet-stream",
          size: MIN_MULTIPART_FILE_PART_BYTES + 3,
          storage_state: "upload_pending",
          multipart_upload_id: "memory-multipart-1",
          direct_upload_expires_at: "2026-01-01T00:15:00.000Z"
        }
      },
      upload: {
        key: "acme/files/file_multipart-large.bin",
        uploadId: "memory-multipart-1"
      }
    });

    const first = await services.files.uploadMultipartPart({
      actor: owner,
      name: prepared.snapshot.name,
      partNumber: 1,
      body: firstPart
    });
    expect(first).toMatchObject({
      part: { partNumber: 1 },
      snapshot: {
        version: 2,
        data: {
          multipart_parts: [{ partNumber: 1, etag: first.part.etag, size: MIN_MULTIPART_FILE_PART_BYTES }]
        }
      }
    });
    const second = await services.files.uploadMultipartPart({
      actor: owner,
      name: prepared.snapshot.name,
      partNumber: 2,
      body: "end"
    });
    expect(second).toMatchObject({
      part: { partNumber: 2 },
      snapshot: {
        version: 3,
        data: {
          multipart_parts: [
            { partNumber: 1, etag: first.part.etag, size: MIN_MULTIPART_FILE_PART_BYTES },
            { partNumber: 2, etag: second.part.etag, size: 3 }
          ]
        }
      }
    });
    await expect(services.files.download({ actor: owner, name: prepared.snapshot.name })).rejects.toMatchObject({
      code: "FILE_UPLOAD_PENDING",
      status: 409
    });

    const completed = await services.files.completeMultipartUpload({
      actor: owner,
      name: prepared.snapshot.name,
      parts: [second.part, first.part],
      expectedVersion: second.snapshot.version
    });

    expect(completed).toMatchObject({
      version: 5,
      data: {
        storage_state: "available",
        etag: `"memory-acme/files/file_multipart-large.bin-multipart-${String(MIN_MULTIPART_FILE_PART_BYTES + 3)}"`
      }
    });
    const downloaded = await services.files.download({ actor: guest, name: prepared.snapshot.name });
    const bytes = new Uint8Array(await new Response(downloaded.object.body).arrayBuffer());
    expect(bytes.byteLength).toBe(MIN_MULTIPART_FILE_PART_BYTES + 3);
    expect(new TextDecoder().decode(bytes.slice(MIN_MULTIPART_FILE_PART_BYTES))).toBe("end");
    await expect(services.store.readStream(documentStream("acme", "File", "file_multipart"))).resolves.toMatchObject([
      {
        type: "FileMultipartUploadReserved",
        payload: {
          kind: "DocumentCreated",
          data: {
            storage_state: "upload_pending",
            multipart_upload_id: "memory-multipart-1"
          }
        }
      },
      {
        type: "FileMultipartPartUploaded",
        payload: {
          kind: "DomainCommandApplied",
          command: "recordMultipartPart",
          patch: {
            multipart_parts: [{ partNumber: 1, etag: first.part.etag, size: MIN_MULTIPART_FILE_PART_BYTES }]
          }
        }
      },
      {
        type: "FileMultipartPartUploaded",
        payload: {
          kind: "DomainCommandApplied",
          command: "recordMultipartPart",
          patch: {
            multipart_parts: [
              { partNumber: 1, etag: first.part.etag, size: MIN_MULTIPART_FILE_PART_BYTES },
              { partNumber: 2, etag: second.part.etag, size: 3 }
            ]
          }
        }
      },
      {
        type: "FileMultipartUploadCompletionStarted",
        payload: {
          kind: "DomainCommandApplied",
          command: "beginMultipartUploadCompletion",
          patch: {
            storage_state: "upload_completing"
          }
        }
      },
      {
        type: "FileMultipartUploadCompleted",
        payload: {
          kind: "DomainCommandApplied",
          command: "completeMultipartUpload",
          patch: {
            storage_state: "available"
          }
        }
      }
    ]);
  });

  it("rejects incomplete multipart completion metadata before consuming storage", async () => {
    const services = createFileServices(["reserve", "part-1", "part-2", "begin", "complete"], ["multipart"]);
    const firstPart = repeatedBytes("a", MIN_MULTIPART_FILE_PART_BYTES);
    const prepared = await services.files.prepareMultipartUpload({
      actor: owner,
      filename: "large.bin",
      size: MIN_MULTIPART_FILE_PART_BYTES + 3
    });
    const first = await services.files.uploadMultipartPart({
      actor: owner,
      name: prepared.snapshot.name,
      partNumber: 1,
      body: firstPart
    });

    await expect(
      services.files.completeMultipartUpload({
        actor: owner,
        name: prepared.snapshot.name,
        parts: [first.part],
        expectedVersion: first.snapshot.version
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Multipart upload object size mismatch"
    });

    const second = await services.files.uploadMultipartPart({
      actor: owner,
      name: prepared.snapshot.name,
      partNumber: 2,
      body: "end"
    });
    await expect(
      services.files.completeMultipartUpload({
        actor: owner,
        name: prepared.snapshot.name,
        parts: [first.part, second.part],
        expectedVersion: second.snapshot.version
      })
    ).resolves.toMatchObject({
      version: 5,
      data: { storage_state: "available" }
    });
  });

  it("rejects unrecorded multipart completion parts before consuming storage", async () => {
    const services = createFileServices(["reserve", "part-1", "part-2", "begin", "complete"], ["multipart"]);
    const firstPart = repeatedBytes("a", MIN_MULTIPART_FILE_PART_BYTES);
    const prepared = await services.files.prepareMultipartUpload({
      actor: owner,
      filename: "large.bin",
      size: MIN_MULTIPART_FILE_PART_BYTES + 3
    });
    const first = await services.files.uploadMultipartPart({
      actor: owner,
      name: prepared.snapshot.name,
      partNumber: 1,
      body: firstPart
    });
    const unrecorded = await services.storage.multipartUploads!.uploadMultipartPart({
      key: "acme/files/file_multipart-large.bin",
      uploadId: "memory-multipart-1",
      partNumber: 2,
      body: "end"
    });

    await expect(
      services.files.completeMultipartUpload({
        actor: owner,
        name: prepared.snapshot.name,
        parts: [first.part, unrecorded],
        expectedVersion: first.snapshot.version
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Multipart upload part 2 was not uploaded"
    });

    const second = await services.files.uploadMultipartPart({
      actor: owner,
      name: prepared.snapshot.name,
      partNumber: 2,
      body: "end"
    });
    await expect(
      services.files.completeMultipartUpload({
        actor: owner,
        name: prepared.snapshot.name,
        parts: [first.part, second.part],
        expectedVersion: second.snapshot.version
      })
    ).resolves.toMatchObject({
      version: 5,
      data: { storage_state: "available" }
    });
  });

  it("rejects oversized multipart parts before streaming to storage", async () => {
    const storage = new CountingMultipartStorage();
    const services = createFileServices(["reserve"], ["multipart"], { storage });
    const prepared = await services.files.prepareMultipartUpload({
      actor: owner,
      filename: "large.bin",
      size: 4
    });

    await expect(
      services.files.uploadMultipartPart({
        actor: owner,
        name: prepared.snapshot.name,
        partNumber: 1,
        body: new Response("12345").body as ReadableStream<Uint8Array>,
        size: 5
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Multipart upload part exceeds reserved file size"
    });
    expect(storage.uploadedParts).toBe(0);
  });

  it("rejects R2-incompatible multipart manifests before beginning completion", async () => {
    const services = createFileServices(["reserve", "part-1", "part-2"], ["multipart"]);
    const prepared = await services.files.prepareMultipartUpload({
      actor: owner,
      filename: "tiny-parts.bin",
      size: 6
    });
    const first = await services.files.uploadMultipartPart({
      actor: owner,
      name: prepared.snapshot.name,
      partNumber: 1,
      body: "abc"
    });
    const second = await services.files.uploadMultipartPart({
      actor: owner,
      name: prepared.snapshot.name,
      partNumber: 2,
      body: "def"
    });

    await expect(
      services.files.completeMultipartUpload({
        actor: owner,
        name: prepared.snapshot.name,
        parts: [first.part, second.part],
        expectedVersion: second.snapshot.version
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `Multipart upload parts before the final part must be at least ${String(MIN_MULTIPART_FILE_PART_BYTES)} bytes`
    });
    await expect(services.queries.getDocument(owner, "File", prepared.snapshot.name)).resolves.toMatchObject({
      version: 3,
      data: { storage_state: "upload_pending" }
    });
  });

  it("scans multipart upload objects before making them available", async () => {
    const scanner = new StaticScanner("clean", { engine: "unit-av", message: "multipart-ok" });
    const services = createFileServices(["reserve", "part", "begin", "complete"], ["multipart"], { scanner });
    const prepared = await services.files.prepareMultipartUpload({
      actor: owner,
      filename: "multipart-clean.txt",
      size: 5,
      contentType: "text/plain",
      isPrivate: false
    });
    const part = await services.files.uploadMultipartPart({
      actor: owner,
      name: prepared.snapshot.name,
      partNumber: 1,
      body: "hello"
    });

    await expect(
      services.files.completeMultipartUpload({
        actor: owner,
        name: prepared.snapshot.name,
        parts: [part.part],
        expectedVersion: part.snapshot.version
      })
    ).resolves.toMatchObject({
      version: 4,
      data: {
        storage_state: "available",
        scan_status: "clean",
        scan_checked_at: now,
        scan_engine: "unit-av",
        scan_message: "multipart-ok"
      }
    });
    expect(scanner.targets).toEqual([
      expect.objectContaining({
        key: "acme/files/file_multipart-multipart-clean.txt",
        filename: "multipart-clean.txt",
        source: "multipart_upload",
        size: 5,
        contentType: "text/plain"
      })
    ]);
  });

  it("keeps multipart completion retryable when scanner adapters fail after storage completion", async () => {
    const services = createFileServices(["reserve", "part", "begin", "complete"], ["multipart"], {
      scanner: {
        async scan() {
          throw new Error("scanner unavailable");
        }
      }
    });
    const prepared = await services.files.prepareMultipartUpload({
      actor: owner,
      filename: "multipart-retry.txt",
      size: 5,
      contentType: "text/plain",
      isPrivate: false
    });
    const part = await services.files.uploadMultipartPart({
      actor: owner,
      name: prepared.snapshot.name,
      partNumber: 1,
      body: "hello"
    });

    await expect(
      services.files.completeMultipartUpload({
        actor: owner,
        name: prepared.snapshot.name,
        parts: [part.part],
        expectedVersion: part.snapshot.version
      })
    ).rejects.toThrow("scanner unavailable");

    expect(services.storage.has("acme/files/file_multipart-multipart-retry.txt")).toBe(true);
    await expect(services.queries.getDocument(owner, "File", prepared.snapshot.name)).resolves.toMatchObject({
      version: 3,
      data: {
        storage_state: "upload_completing",
        scan_status: "pending"
      }
    });
    await expect(services.files.download({ actor: owner, name: prepared.snapshot.name })).rejects.toMatchObject({
      code: "FILE_UPLOAD_PENDING",
      status: 409
    });

    const retryScanner = new StaticScanner("clean", { engine: "unit-av", message: "retried" });
    const retryFiles = new FileService({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      storage: services.storage,
      clock: fixedClock(now),
      ids: deterministicIds(["unused"]),
      scanner: retryScanner
    });
    await expect(
      retryFiles.completeMultipartUpload({
        actor: owner,
        name: prepared.snapshot.name,
        parts: [part.part],
        expectedVersion: part.snapshot.version
      })
    ).resolves.toMatchObject({
      version: 4,
      data: {
        storage_state: "available",
        scan_status: "clean",
        scan_message: "retried"
      }
    });
  });

  it("aborts multipart uploads and removes pending metadata", async () => {
    const services = createFileServices(["reserve", "part", "delete"], ["multipart"]);
    const prepared = await services.files.prepareMultipartUpload({
      actor: owner,
      filename: "cancel.bin",
      size: 4,
      contentType: "application/octet-stream"
    });
    const part = await services.files.uploadMultipartPart({
      actor: owner,
      name: prepared.snapshot.name,
      partNumber: 1,
      body: "data"
    });

    await expect(
      services.files.abortMultipartUpload({
        actor: owner,
        name: prepared.snapshot.name,
        expectedVersion: part.snapshot.version
      })
    ).resolves.toMatchObject({
      docstatus: "deleted",
      version: 3
    });
    await expect(services.queries.getDocument(owner, "File", prepared.snapshot.name)).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND"
    });
    await expect(
      services.storage.multipartUploads?.completeMultipartUpload({
        key: "acme/files/file_multipart-cancel.bin",
        uploadId: "memory-multipart-1",
        parts: [part.part]
      })
    ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
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

  it("transforms image files through an injected transformer after read permission checks", async () => {
    const transformer = new RecordingTransformer();
    const services = createFileServices(["create"], ["object"], { transformer });
    const uploaded = await services.files.upload({
      actor: owner,
      filename: "avatar.png",
      body: "image-bytes",
      contentType: "image/png",
      isPrivate: false
    });

    const transformed = await services.files.transform({
      actor: guest,
      name: uploaded.snapshot.name,
      options: { width: 128, height: 128, fit: "cover", format: "webp", quality: 80 }
    });

    expect(transformed.snapshot.name).toBe(uploaded.snapshot.name);
    expect(transformed.transform.contentType).toBe("image/webp");
    await expect(new Response(transformed.transform.body).text()).resolves.toBe("transformed:image-bytes");
    expect(transformer.commands).toEqual([
      expect.objectContaining({
        actorId: guest.id,
        tenantId: "acme",
        options: { width: 128, height: 128, fit: "cover", format: "webp", quality: 80 },
        source: expect.objectContaining({
          key: "acme/files/file_object-avatar.png",
          filename: "avatar.png",
          contentType: "image/png",
          size: 11
        })
      })
    ]);
  });

  it("inherits download permissions before transforming private files", async () => {
    const transformer = new RecordingTransformer();
    const services = createFileServices(["create"], ["object"], { transformer });
    const uploaded = await services.files.upload({
      actor: owner,
      filename: "private.png",
      body: "secret",
      contentType: "image/png"
    });

    await expect(
      services.files.transform({ actor: guest, name: uploaded.snapshot.name, options: { width: 64 } })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(transformer.commands).toEqual([]);
  });

  it("rejects non-transformable file content before invoking the transformer", async () => {
    const transformer = new RecordingTransformer();
    const services = createFileServices(["create"], ["object"], { transformer });
    const uploaded = await services.files.upload({
      actor: owner,
      filename: "vector.svg",
      body: "<svg></svg>",
      contentType: "image/svg+xml",
      isPrivate: false
    });

    await expect(
      services.files.transform({ actor: guest, name: uploaded.snapshot.name, options: { width: 64 } })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `File '${uploaded.snapshot.name}' cannot be transformed`
    });
    expect(transformer.commands).toEqual([]);
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

  it("bulk deletes selected files through the same event-sourced delete path", async () => {
    const services = createFileServices(
      ["create-1", "create-2", "request-delete-1", "delete-1"],
      ["object-1", "object-2"]
    );
    const selected = await services.files.upload({
      actor: owner,
      filename: "selected.txt",
      body: "selected"
    });
    const stale = await services.files.upload({
      actor: owner,
      filename: "stale.txt",
      body: "stale"
    });

    const result = await services.files.bulkDelete({
      actor: owner,
      files: [
        { name: selected.snapshot.name, expectedVersion: 1 },
        { name: stale.snapshot.name, expectedVersion: 99 },
        { name: "missing" }
      ]
    });

    expect(result).toMatchObject({
      deleted: [
        {
          name: selected.snapshot.name,
          snapshot: { docstatus: "deleted", version: 3 }
        }
      ],
      failed: [
        {
          name: stale.snapshot.name,
          code: "DOCUMENT_CONFLICT",
          status: 409,
          message: "Expected version 99, found 1"
        },
        {
          name: "missing",
          code: "DOCUMENT_NOT_FOUND",
          status: 404
        }
      ]
    });
    expect(services.storage.has("acme/files/file_object-1-selected.txt")).toBe(false);
    expect(services.storage.has("acme/files/file_object-2-stale.txt")).toBe(true);
  });

  it("rejects invalid bulk file delete selections before writing events", async () => {
    const services = createFileServices(["create"], ["object"]);
    const uploaded = await services.files.upload({
      actor: owner,
      filename: "keep.txt",
      body: "keep"
    });

    await expect(services.files.bulkDelete({ actor: owner, files: [] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "At least one file must be selected"
    });
    await expect(
      services.files.bulkDelete({
        actor: owner,
        files: [
          { name: uploaded.snapshot.name },
          { name: uploaded.snapshot.name }
        ]
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `Duplicate file selection '${uploaded.snapshot.name}'`
    });
    expect(services.storage.has("acme/files/file_object-keep.txt")).toBe(true);
  });

  it("rejects bulk file delete batches above the Worker-safe bound", async () => {
    const services = createFileServices();

    await expect(
      services.files.bulkDelete({
        actor: owner,
        files: Array.from({ length: 101 }, (_, index) => ({ name: `file-${String(index)}` }))
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "At most 100 files can be selected"
    });
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

function createFileServices(
  ids: readonly string[] = ["create"],
  fileIds: readonly string[] = ["object"],
  options: {
    readonly scanner?: FileScanner;
    readonly storage?: InMemoryFileStorage;
    readonly transformer?: FileTransformer;
  } = {}
) {
  const registry = createRegistry({ doctypes: [fileDocType] });
  const store = new InMemoryDocumentStore();
  const storage = options.storage ?? new InMemoryFileStorage();
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
    ids: deterministicIds(fileIds),
    ...(options.scanner === undefined ? {} : { scanner: options.scanner }),
    ...(options.transformer === undefined ? {} : { transformer: options.transformer })
  });
  return { registry, store, storage, documents, queries, userPermissions, files };
}

class StaticScanner implements FileScanner {
  readonly targets: FileScanTarget[] = [];

  constructor(
    private readonly status: "clean" | "infected",
    private readonly result: { readonly engine?: string; readonly message?: string } = {}
  ) {}

  async scan(target: FileScanTarget) {
    this.targets.push(target);
    return {
      status: this.status,
      ...this.result
    };
  }
}

class FailingDeleteStorage implements FileStorage {
  constructor(private readonly storage: FileStorage) {}

  put(command: PutFileObjectCommand) {
    return this.storage.put(command);
  }

  head(key: string) {
    return this.storage.head(key);
  }

  get(key: string) {
    return this.storage.get(key);
  }

  createDirectUpload(command: Parameters<NonNullable<FileStorage["createDirectUpload"]>>[0]) {
    if (!this.storage.createDirectUpload) {
      throw new Error("Direct uploads not supported");
    }
    return this.storage.createDirectUpload(command);
  }

  async delete(): Promise<void> {
    throw new Error("delete failed");
  }
}

class CountingMultipartStorage extends InMemoryFileStorage {
  uploadedParts = 0;

  override uploadMultipartPart(command: Parameters<InMemoryFileStorage["uploadMultipartPart"]>[0]) {
    this.uploadedParts += 1;
    return super.uploadMultipartPart(command);
  }
}

class RecordingTransformer implements FileTransformer {
  readonly commands: TransformFileObjectCommand[] = [];

  async transform(command: TransformFileObjectCommand) {
    this.commands.push(command);
    const sourceText = await new Response(command.source.body).text();
    return {
      body: new Response(`transformed:${sourceText}`).body as ReadableStream<Uint8Array>,
      contentType: command.options.format ? `image/${command.options.format}` : command.source.contentType,
      contentLength: `transformed:${sourceText}`.length,
      etag: '"transform"'
    };
  }
}

function repeatedBytes(value: string, size: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(size).fill(new TextEncoder().encode(value)[0] ?? 0);
}
