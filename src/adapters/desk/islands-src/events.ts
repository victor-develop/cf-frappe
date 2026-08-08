/**
 * Typed DOM events islands dispatch on their mount element. This is the ONLY
 * island -> page communication channel (architecture decision: no Desk-wide
 * React root, router, or global store). Page scripts subscribe with plain
 * `addEventListener` on the mount element; events bubble.
 */

export const KANBAN_MOVE_EVENT = "cf-frappe:kanban-move" as const;

export interface KanbanMoveEventDetail {
  readonly board: string;
  readonly doctype: string;
  readonly card: string;
  readonly from: string;
  readonly to: string;
}

export interface DeskIslandEventMap {
  readonly [KANBAN_MOVE_EVENT]: KanbanMoveEventDetail;
}

/** Creates a bubbling, composed CustomEvent for an island event. */
export function islandEvent<K extends keyof DeskIslandEventMap>(
  type: K,
  detail: DeskIslandEventMap[K]
): CustomEvent<DeskIslandEventMap[K]> {
  return new CustomEvent(type, { detail, bubbles: true, composed: true });
}
