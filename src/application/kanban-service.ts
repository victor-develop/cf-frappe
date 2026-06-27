import { permissionDenied } from "../core/errors.js";
import {
  canReadKanban,
  kanbanColumnsForDocType,
  type KanbanColumnDefinition,
  type KanbanDefinition
} from "../core/kanban.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor, DocumentSnapshot, JsonValue } from "../core/types.js";
import type { QueryService } from "./query-service.js";

const DEFAULT_MAX_CARDS_PER_COLUMN = 50;
const PAGE_SIZE = 200;

export interface KanbanCardResult {
  readonly name: string;
  readonly title: string;
  readonly doctype: string;
  readonly docstatus: string;
  readonly version: number;
  readonly updatedAt: string;
  readonly data: Readonly<Record<string, JsonValue>>;
}

export interface KanbanColumnResult {
  readonly value: string;
  readonly label: string;
  readonly indicator?: string;
  readonly total: number;
  readonly hasMore: boolean;
  readonly cards: readonly KanbanCardResult[];
}

export interface KanbanRunResult {
  readonly board: KanbanDefinition;
  readonly columns: readonly KanbanColumnResult[];
}

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
    const states = columns.map((column) => ({
      column,
      cards: [] as KanbanCardResult[],
      total: 0
    }));
    const byValue = new Map(states.map((state) => [state.column.value, state]));
    const limit = board.maxCardsPerColumn ?? DEFAULT_MAX_CARDS_PER_COLUMN;
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
        const state = byValue.get(kanbanColumnValue(document.data[board.columnField]));
        if (state === undefined) {
          continue;
        }
        state.total += 1;
        if (state.cards.length < limit) {
          state.cards.push(kanbanCard(board, document));
        }
      }
      if (offset + page.limit >= page.total) {
        break;
      }
    }
    return {
      board,
      columns: states.map((state) => ({
        value: state.column.value,
        label: state.column.label ?? state.column.value,
        ...(state.column.indicator === undefined ? {} : { indicator: state.column.indicator }),
        total: state.total,
        hasMore: state.total > state.cards.length,
        cards: state.cards
      }))
    };
  }

  private async canAccessKanban(actor: Actor, kanban: KanbanDefinition): Promise<boolean> {
    if (!canReadKanban(actor, kanban)) {
      return false;
    }
    try {
      this.queries.getMeta(actor, kanban.doctype);
      return true;
    } catch (error) {
      if (isPermissionDenied(error)) {
        return false;
      }
      throw error;
    }
  }
}

function kanbanCard(board: KanbanDefinition, document: DocumentSnapshot): KanbanCardResult {
  return {
    name: document.name,
    title: kanbanCardTitle(board, document),
    doctype: document.doctype,
    docstatus: document.docstatus,
    version: document.version,
    updatedAt: document.updatedAt,
    data: document.data
  };
}

function kanbanCardTitle(board: KanbanDefinition, document: DocumentSnapshot): string {
  if (board.titleField === undefined) {
    return document.name;
  }
  const value = document.data[board.titleField];
  return value === undefined || value === null || typeof value === "object" ? document.name : String(value);
}

function kanbanColumnValue(value: JsonValue | undefined): string {
  return value === undefined || value === null || typeof value === "object" ? "" : String(value);
}

function isPermissionDenied(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "PERMISSION_DENIED";
}
