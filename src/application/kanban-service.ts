import { permissionDenied } from "../core/errors.js";
import { FrameworkError } from "../core/errors.js";
import {
  assertKanbanMatchesDocType,
  kanbanColumnsForDocType,
  type KanbanDefinition
} from "../core/kanban.js";
import { normalizeListFilterExpression, normalizeListFilters } from "../core/list-view.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor, DocTypeDefinition } from "../core/types.js";
import { isPermissionDeniedError } from "./access-policy.js";
import type { QueryService } from "./query-service.js";
import {
  applyDocumentToKanbanColumns,
  initialKanbanColumnStates,
  kanbanCardLimit,
  kanbanRunResult,
  type KanbanColumnState,
  type KanbanReadAccessDecision,
  type KanbanRunResult,
  planKanbanReadAccess
} from "./kanban-policy.js";

const PAGE_SIZE = 200;

export type { KanbanCardResult, KanbanColumnResult, KanbanRunResult } from "./kanban-policy.js";

export interface KanbanServiceOptions {
  readonly registry: ModelRegistry;
  readonly queries: QueryService;
}

export class KanbanService {
  private readonly registry: ModelRegistry;
  private readonly queries: QueryService;

  constructor(options: KanbanServiceOptions) {
    this.registry = options.registry;
    this.queries = options.queries;
  }

  async listKanbans(actor: Actor): Promise<readonly KanbanDefinition[]> {
    const readable: KanbanDefinition[] = [];
    for (const kanban of this.registry.listKanbans()) {
      if ((await this.kanbanReadAccess(actor, kanban)).status === "allow") {
        readable.push(kanban);
      }
    }
    return readable;
  }

  async getKanban(actor: Actor, kanbanName: string): Promise<KanbanDefinition> {
    const kanban = this.registry.getKanban(kanbanName);
    const decision = await this.kanbanReadAccess(actor, kanban);
    if (decision.status === "deny") {
      throw permissionDenied(decision.message);
    }
    return kanban;
  }

  async runKanban(actor: Actor, kanbanName: string): Promise<KanbanRunResult> {
    const board = await this.getKanban(actor, kanbanName);
    const doctype = await this.queries.getEffectiveMeta(actor, board.doctype);
    const columns = kanbanColumnsForDocType(board, doctype);
    let states: readonly KanbanColumnState[] = initialKanbanColumnStates(columns);
    const limit = kanbanCardLimit(board.maxCardsPerColumn);
    const filters = board.filters ?? [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await this.queries.listDocuments(actor, board.doctype, {
        filters,
        ...(board.filterExpression === undefined ? {} : { filterExpression: board.filterExpression }),
        orderBy: "updatedAt",
        order: "desc",
        limit: PAGE_SIZE,
        offset,
        maxLimit: PAGE_SIZE
      });
      for (const document of page.data) {
        states = applyDocumentToKanbanColumns(board, states, document, limit);
      }
      if (offset + page.limit >= page.total) {
        break;
      }
    }
    return kanbanRunResult(board, states);
  }

  private async kanbanReadAccess(actor: Actor, kanban: KanbanDefinition): Promise<KanbanReadAccessDecision> {
    try {
      const visibleDoctype = await this.queries.getEffectiveMeta(actor, kanban.doctype);
      assertKanbanMatchesDocType(kanban, visibleDoctype);
      assertKanbanQueryableFields(kanban, await this.queries.getEffectiveQueryMeta(actor, kanban.doctype));
      return planKanbanReadAccess({ actor, board: kanban, doctypeReadable: true });
    } catch (error) {
      if (isPermissionDeniedError(error) || isActorScopedKanbanInvalid(error)) {
        return planKanbanReadAccess({ actor, board: kanban, doctypeReadable: false });
      }
      throw error;
    }
  }
}

function assertKanbanQueryableFields(kanban: KanbanDefinition, doctype: DocTypeDefinition): void {
  normalizeListFilters(doctype, kanban.filters ?? [], { errorCode: "KANBAN_INVALID" });
  if (kanban.filterExpression !== undefined) {
    normalizeListFilterExpression(doctype, kanban.filterExpression, { errorCode: "KANBAN_INVALID" });
  }
}

function isActorScopedKanbanInvalid(error: unknown): boolean {
  return error instanceof FrameworkError && error.code === "KANBAN_INVALID";
}
