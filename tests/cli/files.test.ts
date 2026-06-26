import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote files", () => {
  it("parses remote file list and delete commands", () => {
    expect(parseCliArgs([
      "files",
      "list",
      "--url",
      "https://app.example",
      "--filename",
      "invoice",
      "--content-type",
      "application/pdf",
      "--attached-to-doctype",
      "Sales Invoice",
      "--attached-to-name",
      "SINV-1",
      "--storage-state",
      "available",
      "--scan-status",
      "clean",
      "--uploaded-by",
      "owner@example.com",
      "--private",
      "--limit",
      "5",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "files",
      action: "list",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ],
      attachedToDoctype: "Sales Invoice",
      attachedToName: "SINV-1",
      contentType: "application/pdf",
      filename: "invoice",
      isPrivate: true,
      limit: 5,
      scanStatus: "clean",
      storageState: "available",
      uploadedBy: "owner@example.com"
    });

    expect(parseCliArgs([
      "files",
      "delete",
      "--url",
      "https://app.example",
      "--name",
      "file_invoice",
      "--expected-version",
      "3"
    ])).toEqual({
      kind: "files",
      action: "delete",
      url: "https://app.example",
      headers: [],
      name: "file_invoice",
      expectedVersion: 3
    });

    expect(parseCliArgs([
      "files",
      "update",
      "--url",
      "https://app.example",
      "--name",
      "file_invoice",
      "--filename",
      "renamed.pdf",
      "--public",
      "--attached-to-doctype",
      "Sales Invoice",
      "--attached-to-name",
      "SINV-2",
      "--expected-version",
      "4"
    ])).toEqual({
      kind: "files",
      action: "update",
      url: "https://app.example",
      headers: [],
      name: "file_invoice",
      attachedToDoctype: "Sales Invoice",
      attachedToName: "SINV-2",
      filename: "renamed.pdf",
      isPrivate: false,
      expectedVersion: 4
    });

    expect(parseCliArgs([
      "files",
      "bulk-update",
      "--url",
      "https://app.example",
      "--file",
      "file_invoice",
      "--file-version",
      "file/quote:7",
      "--private",
      "--clear-attachment"
    ])).toEqual({
      kind: "files",
      action: "bulk-update",
      url: "https://app.example",
      headers: [],
      files: [
        { name: "file_invoice" },
        { name: "file/quote", expectedVersion: 7 }
      ],
      isPrivate: true,
      clearAttachment: true
    });

    expect(parseCliArgs([
      "files",
      "bulk-delete",
      "--url",
      "https://app.example",
      "--file",
      "file_invoice",
      "--file-version",
      "file_quote:2"
    ])).toEqual({
      kind: "files",
      action: "bulk-delete",
      url: "https://app.example",
      headers: [],
      files: [
        { name: "file_invoice" },
        { name: "file_quote", expectedVersion: 2 }
      ]
    });

    expect(parseCliArgs(["files", "delete", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "File delete requires --name"
    });
    expect(parseCliArgs([
      "files",
      "list",
      "--url",
      "https://app.example",
      "--attached-to-doctype",
      "Task"
    ])).toEqual({
      kind: "invalid",
      message: "Use --attached-to-doctype and --attached-to-name together"
    });
    expect(parseCliArgs(["files", "list", "--url", "https://app.example", "--private", "--public"])).toEqual({
      kind: "invalid",
      message: "Use only one of --private or --public"
    });
    expect(parseCliArgs(["files", "list", "--url", "https://app.example", "--expected-version", "1"])).toEqual({
      kind: "invalid",
      message: "Cannot use --expected-version with files list"
    });
    expect(parseCliArgs(["files", "update", "--url", "https://app.example", "--name", "file_invoice"])).toEqual({
      kind: "invalid",
      message: "File update requires at least one metadata change"
    });
    expect(parseCliArgs(["files", "bulk-delete", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "File bulk-delete requires at least one --file or --file-version"
    });
    expect(parseCliArgs(["files", "bulk-update", "--url", "https://app.example", "--file", "file_invoice"])).toEqual({
      kind: "invalid",
      message: "File bulk-update requires at least one metadata change"
    });
    expect(parseCliArgs([
      "files",
      "bulk-delete",
      "--url",
      "https://app.example",
      "--file",
      "file_invoice",
      "--file-version",
      "file_invoice:2"
    ])).toEqual({
      kind: "invalid",
      message: "Duplicate file selection 'file_invoice'"
    });
    expect(parseCliArgs([
      "files",
      "bulk-delete",
      "--url",
      "https://app.example",
      "--file-version",
      "file_invoice"
    ])).toEqual({
      kind: "invalid",
      message: "File version selection must use <fileName>:<expectedVersion>"
    });
    expect(parseCliArgs([
      "files",
      "update",
      "--url",
      "https://app.example",
      "--name",
      "file_invoice",
      "--clear-attachment",
      "--attached-to-doctype",
      "Task",
      "--attached-to-name",
      "TASK-1"
    ])).toEqual({
      kind: "invalid",
      message: "Use only one of --clear-attachment or --attached-to-doctype/--attached-to-name"
    });
  });

  it("lists remote files through the admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "files",
        "list",
        "--url",
        "https://app.example/cf",
        "--filename",
        "invoice",
        "--content-type",
        "application/pdf",
        "--attached-to-doctype",
        "Sales Invoice",
        "--attached-to-name",
        "SINV-1",
        "--storage-state",
        "available",
        "--scan-status",
        "clean",
        "--uploaded-by",
        "owner@example.com",
        "--private",
        "--limit",
        "5",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => "/workspace",
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeFetch(calls, {
          data: {
            canUpload: true,
            maxUploadBytes: 1024,
            limit: 5,
            files: [
              {
                name: "file_invoice",
                filename: "invoice.pdf",
                contentType: "application/pdf",
                size: 1234,
                isPrivate: true,
                storageState: "available",
                scanStatus: "clean",
                uploadedBy: "owner@example.com",
                expectedVersion: 3,
                attachedTo: { doctype: "Sales Invoice", name: "SINV-1" }
              }
            ]
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://app.example/cf/api/files?attached_to_doctype=Sales+Invoice&attached_to_name=SINV-1&content_type=application%2Fpdf&filename=invoice&is_private=true&limit=5&scan_status=clean&storage_state=available&uploaded_by=owner%40example.com"
    );
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("Files at https://app.example/cf");
    expect(stdout.text()).toContain("Max upload bytes: 1024");
    expect(stdout.text()).toContain(
      "- invoice.pdf (file_invoice) size 1234 type application/pdf state available scan clean private true attached to Sales Invoice/SINV-1 uploaded by owner@example.com version 3"
    );
  });

  it("deletes one remote file with an optional expected version", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "files",
        "delete",
        "--url",
        "https://app.example",
        "--name",
        "file/invoice",
        "--expected-version",
        "3"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            name: "file/invoice",
            version: 4,
            docstatus: "deleted",
            data: {
              filename: "invoice.pdf",
              storage_state: "deleted"
            }
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/api/files/file%2Finvoice?expectedVersion=3");
    expect(calls[0]?.method).toBe("DELETE");
    expect(stdout.text()).toContain("Deleted file at https://app.example");
    expect(stdout.text()).toContain("- invoice.pdf (file/invoice) version 4 status deleted state deleted");
  });

  it("updates remote file metadata through the admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "files",
        "update",
        "--url",
        "https://app.example",
        "--name",
        "file/invoice",
        "--filename",
        "renamed.pdf",
        "--public",
        "--attached-to-doctype",
        "Sales Invoice",
        "--attached-to-name",
        "SINV-2",
        "--expected-version",
        "3"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            name: "file/invoice",
            version: 4,
            docstatus: "draft",
            data: {
              filename: "renamed.pdf",
              storage_state: "available"
            }
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/api/files/file%2Finvoice");
    expect(calls[0]?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      filename: "renamed.pdf",
      isPrivate: false,
      attachedTo: { doctype: "Sales Invoice", name: "SINV-2" },
      expectedVersion: 3
    });
    expect(stdout.text()).toContain("Updated file at https://app.example");
    expect(stdout.text()).toContain("- renamed.pdf (file/invoice) version 4 status draft state available");
  });

  it("clears remote file attachments with an explicit metadata update", async () => {
    const calls: RemoteCall[] = [];
    const exitCode = await runCli(
      [
        "files",
        "update",
        "--url",
        "https://app.example",
        "--name",
        "file_invoice",
        "--clear-attachment"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            name: "file_invoice",
            version: 5,
            data: { filename: "invoice.pdf" }
          }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.method).toBe("PATCH");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ attachedTo: null });
  });

  it("bulk deletes remote files through the admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "files",
        "bulk-delete",
        "--url",
        "https://app.example",
        "--file-version",
        "file_invoice:3",
        "--file",
        "file_stale"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            deleted: [
              {
                name: "file_invoice",
                snapshot: {
                  name: "file_invoice",
                  version: 4,
                  docstatus: "deleted",
                  data: { filename: "invoice.pdf", storage_state: "deleted" }
                }
              }
            ],
            failed: [
              {
                name: "file_stale",
                code: "DOCUMENT_CONFLICT",
                status: 409,
                message: "Expected version 9, found 1"
              }
            ]
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/api/files/delete");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      files: [
        { name: "file_invoice", expectedVersion: 3 },
        { name: "file_stale" }
      ]
    });
    expect(stdout.text()).toContain("Deleted files at https://app.example");
    expect(stdout.text()).toContain("Succeeded: 1");
    expect(stdout.text()).toContain("- invoice.pdf (file_invoice) version 4 status deleted state deleted");
    expect(stdout.text()).toContain("Failed: 1");
    expect(stdout.text()).toContain("- file_stale failed DOCUMENT_CONFLICT status 409: Expected version 9, found 1");
  });

  it("bulk updates remote file metadata through the admin API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "files",
        "bulk-update",
        "--url",
        "https://app.example",
        "--file",
        "file_invoice",
        "--file-version",
        "file_quote:2",
        "--public",
        "--attached-to-doctype",
        "Sales Invoice",
        "--attached-to-name",
        "SINV-1"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            updated: [
              {
                name: "file_invoice",
                snapshot: {
                  name: "file_invoice",
                  version: 5,
                  data: { filename: "invoice.pdf", storage_state: "available" }
                }
              },
              {
                name: "file_quote",
                snapshot: {
                  name: "file_quote",
                  version: 3,
                  data: { filename: "quote.pdf", storage_state: "available" }
                }
              }
            ],
            failed: []
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/api/files/bulk-metadata");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      files: [
        { name: "file_invoice" },
        { name: "file_quote", expectedVersion: 2 }
      ],
      isPrivate: false,
      attachedTo: { doctype: "Sales Invoice", name: "SINV-1" }
    });
    expect(stdout.text()).toContain("Updated files at https://app.example");
    expect(stdout.text()).toContain("Succeeded: 2");
    expect(stdout.text()).toContain("- invoice.pdf (file_invoice) version 5 state available");
    expect(stdout.text()).toContain("- quote.pdf (file_quote) version 3 state available");
    expect(stdout.text()).toContain("Failed: 0");
  });

  it("maps remote file API errors and missing env headers to CLI failures", async () => {
    const remoteStderr = textBuffer();
    const remoteExit = await runCli(
      ["files", "delete", "--url", "https://app.example", "--name", "missing"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: {
            code: "DOCUMENT_NOT_FOUND",
            message: "File 'missing' was not found"
          }
        }, 404),
        stdout: textBuffer(),
        stderr: remoteStderr
      }
    );

    expect(remoteExit).toBe(1);
    expect(remoteStderr.text()).toContain(
      "Remote file request failed (404): DOCUMENT_NOT_FOUND: File 'missing' was not found"
    );

    const calls: RemoteCall[] = [];
    const envStderr = textBuffer();
    const envExit = await runCli(
      ["files", "list", "--url", "https://app.example", "--header-env", "Authorization=CF_FRAPPE_AUTH"],
      {
        cwd: () => "/workspace",
        env: () => undefined,
        fetch: fakeFetch(calls, {}),
        stdout: textBuffer(),
        stderr: envStderr
      }
    );

    expect(envExit).toBe(1);
    expect(envStderr.text()).toContain("Environment variable 'CF_FRAPPE_AUTH' is not set for header 'Authorization'");
    expect(calls).toEqual([]);
  });
});

interface RemoteCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body?: string;
}

function fakeFetch(calls: RemoteCall[], responseBody: unknown, status = 200): typeof fetch {
  return async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      ...(typeof init?.body === "string" ? { body: init.body } : {})
    });
    return new Response(JSON.stringify(responseBody), {
      headers: { "content-type": "application/json" },
      status
    });
  };
}

function textBuffer(): WritableText & { readonly text: () => string } {
  let value = "";
  return {
    write(chunk) {
      value += chunk;
    },
    text() {
      return value;
    }
  };
}
