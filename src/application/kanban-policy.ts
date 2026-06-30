import { canReadKanban } from "../core/kanban.js";
import type { KanbanColumnDefinition, KanbanDefinition } from "../core/kanban.js";
import { notFound } from "../core/errors.js";
import type { Actor, DocumentSnapshot, JsonValue } from "../core/types.js";

export const DEFAULT_KANBAN_MAX_CARDS_PER_COLUMN = 50;

export type KanbanReadAccessDecision =
  | { readonly status: "allow" }
  | { readonly status: "deny"; readonly message: string };

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

export interface KanbanColumnState {
  readonly column: KanbanColumnDefinition;
  readonly total: number;
  readonly cards: readonly KanbanCardResult[];
}

export function ensureKanbanServiceAvailable<T>(kanbans: T | undefined): asserts kanbans is T {
  if (kanbans === undefined) {
    throw notFound("Kanbans are not enabled");
  }
}

export function planKanbanReadAccess(options: {
  readonly actor: Actor;
  readonly board: KanbanDefinition;
  readonly doctypeReadable: boolean;
}): KanbanReadAccessDecision {
  if (!canReadKanban(options.actor, options.board) || !options.doctypeReadable) {
    return {
      status: "deny",
      message: `Actor '${options.actor.id}' cannot read kanban '${options.board.name}'`
    };
  }
  return { status: "allow" };
}

export function kanbanCardLimit(requested: number | undefined): number {
  return requested ?? DEFAULT_KANBAN_MAX_CARDS_PER_COLUMN;
}

export function initialKanbanColumnStates(columns: readonly KanbanColumnDefinition[]): readonly KanbanColumnState[] {
  return columns.map((column) => Object.freeze({
    column,
    total: 0,
    cards: Object.freeze([])
  }));
}

export function applyDocumentToKanbanColumns(
  board: KanbanDefinition,
  states: readonly KanbanColumnState[],
  document: DocumentSnapshot,
  limit: number
): readonly KanbanColumnState[] {
  const value = kanbanColumnValue(document.data[board.columnField]);
  let changed = false;
  const next = states.map((state) => {
    if (state.column.value !== value) {
      return state;
    }
    changed = true;
    const cards = state.cards.length >= limit
      ? state.cards
      : Object.freeze([...state.cards, kanbanCard(board, document)]);
    return Object.freeze({
      ...state,
      total: state.total + 1,
      cards
    });
  });
  return changed ? next : states;
}

export function kanbanRunResult(
  board: KanbanDefinition,
  states: readonly KanbanColumnState[]
): KanbanRunResult {
  return {
    board,
    columns: states.map(kanbanColumnResult)
  };
}

export function kanbanCard(board: KanbanDefinition, document: DocumentSnapshot): KanbanCardResult {
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

export function kanbanColumnValue(value: JsonValue | undefined): string {
  return value === undefined || value === null || typeof value === "object" ? "" : String(value);
}

function kanbanColumnResult(state: KanbanColumnState): KanbanColumnResult {
  return {
    value: state.column.value,
    label: state.column.label ?? state.column.value,
    ...(state.column.indicator === undefined ? {} : { indicator: state.column.indicator }),
    total: state.total,
    hasMore: state.total > state.cards.length,
    cards: state.cards
  };
}

function kanbanCardTitle(board: KanbanDefinition, document: DocumentSnapshot): string {
  if (board.titleField === undefined) {
    return document.name;
  }
  const value = document.data[board.titleField];
  return value === undefined || value === null || typeof value === "object" ? document.name : String(value);
}
