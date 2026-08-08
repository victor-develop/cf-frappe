/**
 * Pure logic for the Kanban island: mount-config parsing, board/meta payload
 * decoding, move planning (workflow transition vs plain field update),
 * optimistic column updates, and screen-reader announcements.
 *
 * Everything here is framework-free and synchronous so branch coverage is
 * cheap; the React component in islands/kanban-island.tsx stays thin.
 */

export interface KanbanIslandConfig {
  /** Permission-aware board data endpoint (`/api/kanban/<board>/run`). */
  readonly runUrl: string;
  /** Permission-aware doctype meta endpoint (`/api/meta/doctypes/<dt>`). */
  readonly doctypeMetaUrl: string;
}

export interface IslandKanbanCard {
  readonly name: string;
  readonly title: string;
  readonly doctype: string;
  readonly docstatus: string;
  readonly version: number;
  readonly updatedAt: string;
  readonly priority?: string;
}

export interface IslandKanbanColumn {
  readonly value: string;
  readonly label: string;
  readonly total: number;
  readonly hasMore: boolean;
  readonly cards: readonly IslandKanbanCard[];
}

export interface IslandKanbanBoard {
  readonly name: string;
  readonly doctype: string;
  readonly columnField: string;
  readonly columns: readonly IslandKanbanColumn[];
}

/** How card moves must be posted for this board. */
export type KanbanMoveRules =
  | { readonly kind: "field" }
  | {
      readonly kind: "workflow";
      readonly workflow: string;
      readonly transitions: readonly { readonly action: string; readonly from: string; readonly to: string }[];
    };

export type KanbanMovePlan =
  | { readonly ok: true; readonly url: string; readonly body: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly message: string };

const MOUNT_URL_ATTRIBUTES = {
  runUrl: "data-island-run-url",
  doctypeMetaUrl: "data-island-doctype-meta-url"
} as const;

/**
 * Reads and validates the island's bootstrap attributes. Only same-origin
 * absolute paths are accepted so injected markup can never redirect island
 * traffic to a foreign origin.
 */
export function parseKanbanMountConfig(element: {
  getAttribute(name: string): string | null;
}): KanbanIslandConfig {
  return {
    runUrl: mountUrl(element, MOUNT_URL_ATTRIBUTES.runUrl),
    doctypeMetaUrl: mountUrl(element, MOUNT_URL_ATTRIBUTES.doctypeMetaUrl)
  };
}

function mountUrl(element: { getAttribute(name: string): string | null }, attribute: string): string {
  const value = element.getAttribute(attribute) ?? "";
  if (!isSameOriginPath(value)) {
    throw new Error(`kanban island: '${attribute}' must be a same-origin absolute path`);
  }
  return value;
}

/** True for "/api/..."-style paths; false for "//host", "https:..." etc. */
export function isSameOriginPath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}

/** Decodes `GET /api/kanban/<board>/run` into the island's board model. */
export function boardFromRunPayload(payload: unknown): IslandKanbanBoard {
  const data = unwrapData(payload);
  const board = asRecord(data.board, "board");
  const columns = Array.isArray(data.columns) ? data.columns : invalid("columns");
  return {
    name: requiredString(board.name, "board.name"),
    doctype: requiredString(board.doctype, "board.doctype"),
    columnField: requiredString(board.columnField, "board.columnField"),
    columns: columns.map(columnFromPayload)
  };
}

function columnFromPayload(payload: unknown): IslandKanbanColumn {
  const column = asRecord(payload, "column");
  const cards = Array.isArray(column.cards) ? column.cards : invalid("column.cards");
  return {
    value: requiredString(column.value, "column.value"),
    label: typeof column.label === "string" && column.label !== "" ? column.label : requiredString(column.value, "column.value"),
    total: typeof column.total === "number" ? column.total : 0,
    hasMore: column.hasMore === true,
    cards: cards.map(cardFromPayload)
  };
}

function cardFromPayload(payload: unknown): IslandKanbanCard {
  const card = asRecord(payload, "card");
  const data = typeof card.data === "object" && card.data !== null ? (card.data as Record<string, unknown>) : {};
  const priority = typeof data.priority === "string" && data.priority !== "" ? data.priority : undefined;
  return {
    name: requiredString(card.name, "card.name"),
    title: requiredString(card.title, "card.title"),
    doctype: requiredString(card.doctype, "card.doctype"),
    docstatus: typeof card.docstatus === "string" ? card.docstatus : "",
    version: typeof card.version === "number" ? card.version : 0,
    updatedAt: typeof card.updatedAt === "string" ? card.updatedAt : "",
    ...(priority === undefined ? {} : { priority })
  };
}

/**
 * Derives the move rules from `GET /api/meta/doctypes/<dt>`: when a workflow
 * owns the board's column field, moves MUST go through its transition
 * endpoint (the server rejects direct patches of workflow state fields);
 * otherwise moves are a plain field update.
 */
export function moveRulesFromDoctypeMeta(payload: unknown, columnField: string): KanbanMoveRules {
  const data = unwrapData(payload);
  const workflows = Array.isArray(data.workflows) ? data.workflows : [];
  for (const entry of workflows) {
    const workflow = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    if (workflow.stateField !== columnField || typeof workflow.name !== "string") {
      continue;
    }
    const transitions = Array.isArray(workflow.transitions) ? workflow.transitions : [];
    return {
      kind: "workflow",
      workflow: workflow.name,
      transitions: transitions.flatMap((item) => {
        const transition = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
        return typeof transition.action === "string" &&
          typeof transition.from === "string" &&
          typeof transition.to === "string"
          ? [{ action: transition.action, from: transition.from, to: transition.to }]
          : [];
      })
    };
  }
  return { kind: "field" };
}

/**
 * Plans a card move as a POST against the same Desk endpoints the document
 * form uses (`/desk/:doctype/:name` or the workflow transition route), with
 * `expectedVersion` for optimistic concurrency. The server stays the
 * authority — the plan carries no client-side permission decisions.
 */
export function planKanbanMove(options: {
  readonly board: IslandKanbanBoard;
  readonly rules: KanbanMoveRules;
  readonly card: IslandKanbanCard;
  readonly from: string;
  readonly to: string;
}): KanbanMovePlan {
  const { board, rules, card, from, to } = options;
  if (from === to) {
    return { ok: false, message: `${card.title} is already in ${columnLabel(board, to)}.` };
  }
  const documentPath = `/desk/${encodeURIComponent(board.doctype)}/${encodeURIComponent(card.name)}`;
  if (rules.kind === "field") {
    return {
      ok: true,
      url: documentPath,
      body: { [board.columnField]: to, expectedVersion: String(card.version) }
    };
  }
  const transition = rules.transitions.find((item) => item.from === from && item.to === to);
  if (transition === undefined) {
    return {
      ok: false,
      message: `No workflow transition from ${columnLabel(board, from)} to ${columnLabel(board, to)}.`
    };
  }
  return {
    ok: true,
    url: `${documentPath}/workflows/${encodeURIComponent(rules.workflow)}/transition/${encodeURIComponent(transition.action)}`,
    body: { expectedVersion: String(card.version) }
  };
}

/** Column label lookup with the raw value as fallback. */
export function columnLabel(board: IslandKanbanBoard, value: string): string {
  return board.columns.find((column) => column.value === value)?.label ?? value;
}

/**
 * Optimistically moves a card between columns; totals follow the card.
 * Returns the original board when the card is not in `from`.
 */
export function applyOptimisticMove(
  board: IslandKanbanBoard,
  cardName: string,
  from: string,
  to: string
): IslandKanbanBoard {
  const source = board.columns.find((column) => column.value === from);
  const card = source?.cards.find((item) => item.name === cardName);
  if (source === undefined || card === undefined || from === to) {
    return board;
  }
  return {
    ...board,
    columns: board.columns.map((column) => {
      if (column.value === from) {
        return {
          ...column,
          total: Math.max(0, column.total - 1),
          cards: column.cards.filter((item) => item.name !== cardName)
        };
      }
      if (column.value === to) {
        return { ...column, total: column.total + 1, cards: [...column.cards, card] };
      }
      return column;
    })
  };
}

/** The next/previous column value for keyboard targeting; wraps at edges. */
export function adjacentColumnValue(
  board: IslandKanbanBoard,
  current: string,
  direction: -1 | 1
): string {
  const values = board.columns.map((column) => column.value);
  if (values.length === 0) {
    return current;
  }
  const index = values.indexOf(current);
  const start = index === -1 ? 0 : index;
  const next = (start + direction + values.length) % values.length;
  return values[next] ?? current;
}

export const KANBAN_GRAB_INSTRUCTIONS =
  "Press Enter or Space to pick up a card, left and right arrows to choose a column, Enter to drop, Escape to cancel.";

export function grabAnnouncement(board: IslandKanbanBoard, card: IslandKanbanCard, from: string): string {
  return `Picked up ${card.title} from ${columnLabel(board, from)}. ${KANBAN_GRAB_INSTRUCTIONS}`;
}

export function targetAnnouncement(board: IslandKanbanBoard, card: IslandKanbanCard, target: string): string {
  return `${card.title} targeting ${columnLabel(board, target)}. Press Enter to drop.`;
}

export function dropAnnouncement(board: IslandKanbanBoard, card: IslandKanbanCard, to: string): string {
  return `Moved ${card.title} to ${columnLabel(board, to)}.`;
}

export function cancelAnnouncement(card: IslandKanbanCard): string {
  return `Cancelled moving ${card.title}.`;
}

export function failureAnnouncement(card: IslandKanbanCard, message: string): string {
  return `Could not move ${card.title}: ${message}`;
}

function unwrapData(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload, "payload");
  return typeof record.data === "object" && record.data !== null
    ? (record.data as Record<string, unknown>)
    : record;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(label);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") {
    return invalid(label);
  }
  return value;
}

function invalid(label: string): never {
  throw new Error(`kanban island: invalid '${label}' in server payload`);
}
