import { badRequest, FrameworkError } from "../core/errors.js";
import type {
  BulkDeleteDocumentFailure,
  BulkDeleteDocumentSelection,
  BulkDocumentCommand,
  BulkDocumentCommandFailure,
  BulkDocumentsCommand,
  BulkDocumentSelection
} from "./document-service.js";

const MAX_BULK_DOCUMENTS = 100;

export function normalizeBulkDeleteDocumentSelections(
  documents: readonly BulkDeleteDocumentSelection[]
): readonly BulkDeleteDocumentSelection[] {
  return normalizeBulkDocumentSelections(documents);
}

export function normalizeBulkDocumentSelections(
  documents: readonly BulkDocumentSelection[]
): readonly BulkDocumentSelection[] {
  if (documents.length === 0) {
    throw badRequest("At least one document must be selected");
  }
  if (documents.length > MAX_BULK_DOCUMENTS) {
    throw badRequest(`At most ${String(MAX_BULK_DOCUMENTS)} documents can be selected`);
  }
  const seen = new Set<string>();
  return documents.map((document) => {
    const name = document.name.trim();
    if (name === "") {
      throw badRequest("Document name is required");
    }
    if (seen.has(name)) {
      throw badRequest(`Duplicate document selection '${name}'`);
    }
    seen.add(name);
    if (document.expectedVersion !== undefined && !Number.isInteger(document.expectedVersion)) {
      throw badRequest("expectedVersion must be an integer");
    }
    return {
      name,
      ...(document.expectedVersion === undefined ? {} : { expectedVersion: document.expectedVersion })
    };
  });
}

export function bulkDeleteDocumentFailure(name: string, error: unknown): BulkDeleteDocumentFailure {
  return bulkDocumentFailure(name, error);
}

export function bulkDocumentFailure(name: string, error: unknown): BulkDocumentCommandFailure {
  if (error instanceof FrameworkError) {
    return {
      name,
      code: error.code,
      message: error.message,
      status: error.status
    };
  }
  return {
    name,
    code: "UNKNOWN",
    message: error instanceof Error ? error.message : "Bulk delete failed",
    status: 500
  };
}

export function bulkNamedCommand(
  command: BulkDocumentsCommand,
  selection: BulkDocumentSelection
): BulkDocumentCommand {
  return {
    actor: command.actor,
    doctype: command.doctype,
    name: selection.name,
    ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
    ...(selection.expectedVersion === undefined ? {} : { expectedVersion: selection.expectedVersion }),
    metadata: command.metadata ?? {}
  };
}
