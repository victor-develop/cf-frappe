/**
 * Network seam for the Kanban island. The React component only sees this
 * interface, so tests stub it and the component never touches `fetch`
 * directly. All requests hit the same permission-aware endpoints the
 * server-rendered Desk pages use; the server remains the authority.
 */
import {
  boardFromRunPayload,
  moveRulesFromDoctypeMeta,
  type IslandKanbanBoard,
  type KanbanIslandConfig,
  type KanbanMoveRules
} from "./kanban-logic.js";

export interface KanbanMoveOutcome {
  readonly ok: boolean;
  readonly message: string;
}

export interface KanbanIslandIo {
  /** Loads the board (columns + cards) from the run endpoint. */
  loadBoard(): Promise<IslandKanbanBoard>;
  /** Loads the doctype meta and derives how moves must be posted. */
  loadMoveRules(columnField: string): Promise<KanbanMoveRules>;
  /** Posts a planned move using the Desk form endpoints (form-encoded). */
  postMove(url: string, body: Readonly<Record<string, string>>): Promise<KanbanMoveOutcome>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createKanbanIslandIo(config: KanbanIslandConfig, fetchImpl: FetchLike): KanbanIslandIo {
  return {
    async loadBoard() {
      return boardFromRunPayload(await readJson(fetchImpl, config.runUrl));
    },
    async loadMoveRules(columnField) {
      return moveRulesFromDoctypeMeta(await readJson(fetchImpl, config.doctypeMetaUrl), columnField);
    },
    async postMove(url, body) {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams(body).toString(),
        credentials: "same-origin"
      });
      return response.ok
        ? { ok: true, message: "" }
        : { ok: false, message: `the server rejected the move (HTTP ${String(response.status)}).` };
    }
  };
}

async function readJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const response = await fetchImpl(url, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`kanban island: GET ${url} failed (HTTP ${String(response.status)})`);
  }
  return (await response.json()) as unknown;
}
