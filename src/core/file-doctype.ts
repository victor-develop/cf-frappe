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
  readonly storage_state: "available" | "delete_requested";
  readonly deletion_requested_at?: string;
  readonly attached_to_doctype?: string;
  readonly attached_to_name?: string;
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
      options: ["available", "delete_requested"],
      defaultValue: "available"
    },
    { name: "deletion_requested_at", label: "Deletion Requested At", type: "datetime" },
    { name: "attached_to_doctype", label: "Attached To DocType", type: "text" },
    { name: "attached_to_name", label: "Attached To Name", type: "text" }
  ],
  permissions: [
    {
      roles: [SYSTEM_MANAGER_ROLE],
      actions: ["read", "create", "update", "delete"]
    },
    {
      roles: ["User"],
      actions: ["create"]
    },
    {
      roles: ["User"],
      actions: ["read"],
      when: ({ actor, document }) =>
        Boolean(document && (document.data.uploaded_by === actor.id || document.data.is_private === false))
    },
    {
      roles: ["User"],
      actions: ["delete"],
      when: ({ actor, document }) => document?.data.uploaded_by === actor.id
    },
    {
      roles: ["Guest"],
      actions: ["read"],
      when: ({ document }) => document?.data.is_private === false
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
    }
  ],
  indexes: [["attached_to_doctype", "attached_to_name"], ["uploaded_by"], ["is_private"]]
});
