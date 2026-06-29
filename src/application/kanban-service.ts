import { permissionDenied } from "../core/errors.js";
import {
  canReadKanban,
  kanbanColumnsForDocType,
  type KanbanDefinition
} from "../core/kanban.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor } from "../core/types.js";
import { isPermissionDeniedError } from "./access-policy.js";
import type { QueryService } from "./query-service.js";
import {
  applyDocumentToKanbanColumns,
  initialKanbanColumnStates,
  kanbanCardLimit,
  kanbanRunResult,
  type KanbanColumnState,
  type KanbanRunResult
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
      if (await this.canAccessKanban(actor, kanban)) {
        readable.push(kanban);
      }
    }
    return readable;
  }

  async getKanban(actor: Actor, kanbanName: string): Promise<KanbanDefinition> {
    const kanban = this.registry.getKanban(kanbanName);
    if (!(await this.canAccessKanban(actor, kanban))) {
      throw permissionDenied(`Actor '${actor.id}' cannot read kanban '${kanban.name}'`);
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

  private async canAccessKanban(actor: Actor, kanban: KanbanDefinition): Promise<boolean> {
    if (!canReadKanban(actor, kanban)) {
      return false;
    }
    try {
      this.queries.getMeta(actor, kanban.doctype);
      return true;
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        return false;
      }
      throw error;
    }
  }
}
