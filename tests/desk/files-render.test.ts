import { defineDocType } from "../../src/core/schema.js";
import { type FileDashboard } from "../../src/application/file-service.js";
import { renderFileAttachmentPanel, renderFileManager } from "../../src/adapters/desk/views/files.js";

type FileEntry = FileDashboard["files"][number];

function fileEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    name: "FILE-1",
    filename: "report.pdf",
    contentType: "application/pdf",
    size: 512,
    isPrivate: true,
    previewable: false,
    storageState: "available",
    uploadedBy: "user-1",
    uploadedAt: "2026-08-01T00:00:00Z",
    expectedVersion: 2,
    editable: false,
    deletable: false,
    ...overrides
  };
}

function dashboard(overrides: Partial<FileDashboard> = {}): FileDashboard {
  return {
    canUpload: true,
    directUpload: false,
    maxUploadBytes: 1024 * 1024,
    files: [],
    limit: 50,
    filters: {},
    ...overrides
  };
}

describe("Desk file manager", () => {
  it("renders an empty manager with default options and no bulk actions", () => {
    const html = renderFileManager(dashboard());
    expect(html).toContain("No files found.");
    expect(html).toContain("Upload File");
    expect(html).not.toContain("Delete selected");
    expect(html).not.toContain("Update selected metadata");
    expect(html).not.toContain('data-upload-mode');
  });

  it("hides the upload form but keeps the error when uploads are denied", () => {
    const html = renderFileManager(dashboard({ canUpload: false }), { error: "Upload rejected" });
    expect(html).not.toContain("Upload File");
    expect(html).toContain("Upload rejected");
  });

  it("renders file rows covering privacy, sizes, attachment, and per-row actions", () => {
    const Task = defineDocType({ name: "Task", fields: [{ name: "title", type: "text" }] });
    const html = renderFileManager(
      dashboard({
        directUpload: true,
        files: [
          fileEntry({
            name: "FILE-1",
            previewable: true,
            editable: true,
            deletable: true,
            attachedTo: { doctype: "Task", name: "TASK-1" }
          }),
          fileEntry({ name: "FILE-2", filename: "notes.txt", size: 2048, isPrivate: false }),
          fileEntry({ name: "FILE-3", filename: "video.mp4", size: 5 * 1024 * 1024, editable: true }),
          fileEntry({ name: "FILE-4", filename: "old.log", deletable: true })
        ],
        filters: {
          attachedToDoctype: "Task",
          attachedToName: "TASK-1",
          filename: "report",
          contentType: "application/pdf",
          uploadedBy: "user-1",
          storageState: "mystery_state",
          scanStatus: "clean",
          isPrivate: true
        }
      }),
      {
        doctypes: [Task],
        documentSuggestions: [
          {
            doctype: "Task",
            name: "TASK-1",
            tenantId: "tenant-a",
            version: 1,
            docstatus: "draft",
            createdAt: "2026-08-01T00:00:00Z",
            updatedAt: "2026-08-01T00:00:00Z",
            data: {}
          }
        ]
      }
    );
    expect(html).toContain('data-upload-mode="direct"');
    expect(html).toContain("Delete selected");
    expect(html).toContain("Update selected metadata");
    expect(html).toContain("512 B");
    expect(html).toContain("2.0 KiB");
    expect(html).toContain("5.0 MiB");
    expect(html).toContain("Task/TASK-1");
    expect(html).toContain(">Preview</a>");
    expect(html).toContain('aria-label="Select report.pdf"');
    expect(html).not.toContain('aria-label="Select notes.txt"');
    expect(html).toContain('<option value="mystery_state" selected>mystery_state</option>');
    expect(html).toContain('<option value="clean" selected>Clean</option>');
    expect(html).toContain('<option value="1" selected>Private</option>');
    expect(html).toContain("/desk/files/FILE-1/metadata");
    expect(html).toContain("/desk/files/FILE-4/delete");
  });

  it("selects the public privacy filter option", () => {
    const html = renderFileManager(dashboard({ filters: { isPrivate: false } }));
    expect(html).toContain('<option value="0" selected>Public</option>');
  });
});

describe("Desk file attachment panel", () => {
  it("renders an empty upload-enabled panel", () => {
    const html = renderFileAttachmentPanel("Task", "TASK-1", dashboard({ directUpload: true }));
    expect(html).toContain("No files attached.");
    expect(html).toContain('action="/desk/Task/TASK-1/files"');
    expect(html).toContain('data-upload-mode="direct"');
    expect(html).toContain("attached_to_doctype=Task");
  });

  it("keeps the error visible when uploads are denied", () => {
    const html = renderFileAttachmentPanel("Task", "TASK-1", dashboard({ canUpload: false }), {
      error: "Quota exceeded"
    });
    expect(html).toContain("Quota exceeded");
    expect(html).not.toContain('type="file"');
  });

  it("renders attached rows with and without delete actions", () => {
    const html = renderFileAttachmentPanel(
      "Task",
      "TASK-1",
      dashboard({
        files: [
          fileEntry({ name: "FILE-1", deletable: true }),
          fileEntry({ name: "FILE-2", filename: "notes.txt", isPrivate: false })
        ]
      })
    );
    expect(html).toContain("/desk/Task/TASK-1/files/FILE-1/delete");
    expect(html).toContain(">yes</td>");
    expect(html).toContain(">no</td>");
    expect(html).not.toContain("FILE-2/delete");
  });
});
