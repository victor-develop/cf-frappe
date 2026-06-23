import { defineDocType } from "./schema.js";
import { SYSTEM_MANAGER_ROLE, type DocTypeDefinition, type DocumentData } from "./types.js";

export const FILE_DOCTYPE_NAME = "File";

export interface FileDocumentData extends DocumentData {
  readonly filename: string;
  readonly key: string;
  readonly content_type: string;
  readonly size: number;
  readonly is_private: boolean;
  readonly uploaded_by: string;
  readonly uploaded_at: string;
  readonly etag?: string;
  readonly storage_state: "upload_pending" | "upload_completing" | "available" | "scan_failed" | "delete_requested";
  readonly direct_upload_expires_at?: string;
  readonly multipart_upload_id?: string;
  readonly multipart_parts?: readonly {
    readonly partNumber: number;
    readonly etag: string;
    readonly size: number;
  }[];
  readonly scan_status?: "pending" | "clean" | "infected";
  readonly scan_checked_at?: string;
  readonly scan_engine?: string;
  readonly scan_message?: string;
  readonly renditions?: readonly FileRenditionDocumentData[];
  readonly deletion_requested_at?: string;
  readonly attached_to_doctype?: string;
  readonly attached_to_name?: string;
}

export interface FileRenditionDocumentData extends DocumentData {
  readonly id: string;
  readonly key: string;
  readonly status: "pending" | "available" | "failed";
  readonly options: DocumentData;
  readonly requested_at: string;
  readonly requested_by: string;
  readonly source_etag?: string;
  readonly content_type?: string;
  readonly size?: number;
  readonly etag?: string;
  readonly http_etag?: string;
  readonly generated_at?: string;
  readonly generated_by?: string;
  readonly failure_message?: string;
}

export const fileDocType: DocTypeDefinition<FileDocumentData> = defineDocType<FileDocumentData>({
  name: FILE_DOCTYPE_NAME,
  module: "Core",
  label: "File",
  version: 1,
  naming: { kind: "uuid" },
  fields: [
    { name: "filename", label: "Filename", type: "text", required: true, max: 255 },
    { name: "key", label: "Storage Key", type: "text", required: true, readOnly: true, max: 1024 },
    { name: "content_type", label: "Content Type", type: "text", required: true },
    { name: "size", label: "Size", type: "integer", required: true, min: 0 },
    { name: "is_private", label: "Private", type: "boolean", defaultValue: true },
    { name: "uploaded_by", label: "Uploaded By", type: "text", readOnly: true, defaultValue: ({ actor }) => actor.id },
    { name: "uploaded_at", label: "Uploaded At", type: "datetime", readOnly: true, defaultValue: ({ now }) => now },
    { name: "etag", label: "ETag", type: "text", readOnly: true },
    {
      name: "storage_state",
      label: "Storage State",
      type: "select",
      options: ["upload_pending", "upload_completing", "available", "scan_failed", "delete_requested"],
      defaultValue: "available"
    },
    { name: "direct_upload_expires_at", label: "Direct Upload Expires At", type: "datetime", readOnly: true },
    { name: "multipart_upload_id", label: "Multipart Upload ID", type: "text", readOnly: true },
    { name: "multipart_parts", label: "Multipart Parts", type: "json", readOnly: true },
    { name: "scan_status", label: "Scan Status", type: "select", options: ["pending", "clean", "infected"], readOnly: true },
    { name: "scan_checked_at", label: "Scan Checked At", type: "datetime", readOnly: true },
    { name: "scan_engine", label: "Scan Engine", type: "text", readOnly: true },
    { name: "scan_message", label: "Scan Message", type: "text", readOnly: true },
    { name: "renditions", label: "Renditions", type: "json", readOnly: true },
    { name: "deletion_requested_at", label: "Deletion Requested At", type: "datetime" },
    { name: "attached_to_doctype", label: "Attached To DocType", type: "text" },
    { name: "attached_to_name", label: "Attached To Name", type: "text" }
  ],
  permissions: [
    {
      roles: [SYSTEM_MANAGER_ROLE],
      actions: ["read", "rendition", "create", "metadata", "update", "delete"]
    },
    {
      roles: ["User"],
      actions: ["create"]
    },
    {
      roles: ["User"],
      actions: ["read"],
      when: ({ actor, document }) =>
        Boolean(
          document &&
            (document.data.uploaded_by === actor.id ||
              (document.data.is_private === false && document.data.storage_state === "available"))
        )
    },
    {
      roles: ["User"],
      actions: ["delete"],
      when: ({ actor, document }) => document?.data.uploaded_by === actor.id
    },
    {
      roles: ["User"],
      actions: ["metadata", "rendition"],
      when: ({ actor, document }) => document?.data.uploaded_by === actor.id
    },
    {
      roles: ["Guest"],
      actions: ["read"],
      when: ({ document }) => document?.data.is_private === false && document.data.storage_state === "available"
    }
  ],
  commands: [
    {
      name: "requestDelete",
      eventType: "FileDeleteRequested",
      permissionAction: "delete",
      buildPatch: ({ now }) => ({
        storage_state: "delete_requested",
        deletion_requested_at: now
      })
    },
    {
      name: "updateMetadata",
      eventType: "FileMetadataUpdated",
      fields: ["filename", "is_private", "attached_to_doctype", "attached_to_name"],
      internal: true,
      permissionAction: "metadata"
    },
    {
      name: "completeDirectUpload",
      eventType: "FileDirectUploadCompleted",
      fields: ["storage_state", "etag", "scan_status", "scan_checked_at", "scan_engine", "scan_message"],
      internal: true,
      allowReadOnlyFields: true,
      permissionAction: "metadata"
    },
    {
      name: "beginMultipartUploadCompletion",
      eventType: "FileMultipartUploadCompletionStarted",
      fields: ["storage_state"],
      internal: true,
      permissionAction: "metadata"
    },
    {
      name: "completeMultipartUpload",
      eventType: "FileMultipartUploadCompleted",
      fields: ["storage_state", "etag", "scan_status", "scan_checked_at", "scan_engine", "scan_message"],
      internal: true,
      allowReadOnlyFields: true,
      permissionAction: "metadata"
    },
    {
      name: "recordMultipartPart",
      eventType: "FileMultipartPartUploaded",
      fields: ["multipart_parts"],
      internal: true,
      allowReadOnlyFields: true,
      permissionAction: "metadata"
    },
    {
      name: "failScan",
      eventType: "FileScanFailed",
      fields: ["storage_state", "etag", "scan_status", "scan_checked_at", "scan_engine", "scan_message"],
      internal: true,
      allowReadOnlyFields: true,
      permissionAction: "metadata"
    },
    {
      name: "reserveRendition",
      eventType: "FileRenditionRequested",
      fields: ["renditions"],
      internal: true,
      allowReadOnlyFields: true,
      permissionAction: "rendition"
    },
    {
      name: "completeRendition",
      eventType: "FileRenditionGenerated",
      fields: ["renditions"],
      internal: true,
      allowReadOnlyFields: true,
      permissionAction: "rendition"
    },
    {
      name: "failRendition",
      eventType: "FileRenditionFailed",
      fields: ["renditions"],
      internal: true,
      allowReadOnlyFields: true,
      permissionAction: "rendition"
    }
  ],
  indexes: [["attached_to_doctype", "attached_to_name"], ["uploaded_by"], ["is_private"]]
});
