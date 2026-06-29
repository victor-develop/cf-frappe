import type { Actor, DocumentData } from "../core/types.js";
import type { DocumentCommandExecutor } from "./document-service.js";
import type { QueryService } from "./query-service.js";
import { parseCsv } from "./csv.js";
import {
  assertImportRowLimit,
  documentImportFailure,
  documentImportRowInput,
  documentImportRowName,
  normalizeImportMaxRows,
  requiredImportUpdateName,
  validateImportHeaders,
  type DocumentImportFailure,
  type DocumentImportMode,
  type DocumentImportResult,
  type DocumentImportRowInput,
  type DocumentImportSuccess
} from "./document-import-policy.js";

export * from "./document-import-policy.js";

export interface DocumentImportServiceOptions {
  readonly documents: Pick<DocumentCommandExecutor, "create" | "update">;
  readonly queries: Pick<QueryService, "getEffectiveMeta">;
  readonly maxRows?: number;
}

export interface ImportDocumentsCsvCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly csv: string;
  readonly mode?: DocumentImportMode;
  readonly metadata?: DocumentData;
}

export class DocumentImportService {
  private readonly documents: Pick<DocumentCommandExecutor, "create" | "update">;
  private readonly queries: Pick<QueryService, "getEffectiveMeta">;
  private readonly maxRows: number;

  constructor(options: DocumentImportServiceOptions) {
    this.documents = options.documents;
    this.queries = options.queries;
    this.maxRows = normalizeImportMaxRows(options.maxRows);
  }

  async importCsv(command: ImportDocumentsCsvCommand): Promise<DocumentImportResult> {
    const mode = command.mode ?? "create";
    const parsed = parseCsv(command.csv);
    assertImportRowLimit(parsed.rows.length, this.maxRows);
    const doctype = await this.queries.getEffectiveMeta(command.actor, command.doctype);
    validateImportHeaders(doctype, parsed.headers);

    const succeeded: DocumentImportSuccess[] = [];
    const failed: DocumentImportFailure[] = [];
    for (const row of parsed.rows) {
      let input: DocumentImportRowInput | undefined;
      try {
        input = documentImportRowInput(parsed.headers, row, doctype);
        const document = mode === "create"
          ? await this.documents.create({
              actor: command.actor,
              doctype: doctype.name,
              data: input.data,
              ...(input.name === undefined ? {} : { name: input.name }),
              ...(command.metadata === undefined ? {} : { metadata: command.metadata })
            })
          : await this.documents.update({
              actor: command.actor,
              doctype: doctype.name,
              name: requiredImportUpdateName(input.name, row.line),
              patch: input.data,
              ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
              ...(command.metadata === undefined ? {} : { metadata: command.metadata })
        });
        succeeded.push({ row: row.line, action: mode, name: document.name, document });
      } catch (error) {
        failed.push(
          documentImportFailure(row.line, mode, input?.name ?? documentImportRowName(parsed.headers, row), error)
        );
      }
    }
    return {
      doctype: doctype.name,
      mode,
      total: parsed.rows.length,
      succeeded,
      failed
    };
  }
}
