import { badRequest, FrameworkError } from "../core/errors.js";
import type {
  BulkDeleteDocumentFailure,
  BulkDeleteDocumentSelection,
  BulkDocumentCommand,
  BulkDocumentCommandEntry,
  BulkDocumentCommandFailure,
  BulkDocumentCommandResult,
  BulkDocumentsCommand,
  BulkDocumentSelection
} from "./document-service.js";
import type { DocumentSnapshot } from "../core/types.js";

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

export type BulkDocumentSelectionOutcome =
  | { readonly ok: true; readonly snapshot: DocumentSnapshot }
  | { readonly ok: false; readonly failure: BulkDocumentCommandFailure };

export function bulkDocumentSelectionSuccess(
  selection: BulkDocumentSelection,
  snapshot: DocumentSnapshot
): BulkDocumentCommandEntry {
  return { name: selection.name, snapshot };
}

export async function runBulkDocumentSelections(
  command: BulkDocumentsCommand,
  run: (selection: BulkDocumentSelection) => Promise<BulkDocumentSelectionOutcome>
): Promise<BulkDocumentCommandResult> {
  const selections = normalizeBulkDocumentSelections(command.documents);
  const succeeded: BulkDocumentCommandEntry[] = [];
  const failed: BulkDocumentCommandFailure[] = [];
  for (const selection of selections) {
    const outcome = await run(selection);
    if (outcome.ok) {
      succeeded.push(bulkDocumentSelectionSuccess(selection, outcome.snapshot));
    } else {
      failed.push(outcome.failure);
    }
  }
  return { succeeded, failed };
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
