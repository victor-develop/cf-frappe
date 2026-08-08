/** @jsxImportSource react */
/**
 * Kanban island entry: the module the loader dynamic-imports for
 * `[data-cf-frappe-island="kanban"]`. Mounts a client-only React root inside
 * the declared boundary (no SSR/hydration), bootstrapped exclusively from
 * the IDs and permission-aware API URLs on the mount element.
 */
import { createRoot } from "react-dom/client";
import { islandEvent, KANBAN_MOVE_EVENT, type KanbanMoveEventDetail } from "../events.js";
import { createKanbanIslandIo } from "../kanban-io.js";
import { parseKanbanMountConfig } from "../kanban-logic.js";
import { KanbanIsland } from "./kanban-island.js";

export default function mountKanbanIsland(element: HTMLElement): void {
  const config = parseKanbanMountConfig(element);
  const fallback = element.querySelector<HTMLElement>("[data-island-fallback]");
  const host = element.ownerDocument.createElement("div");
  host.className = "kanban-island-host";
  element.appendChild(host);
  const io = createKanbanIslandIo(config, (input, init) => fetch(input, init));
  const emitMove = (detail: KanbanMoveEventDetail): void => {
    element.dispatchEvent(islandEvent(KANBAN_MOVE_EVENT, detail));
  };
  const onReady = (): void => {
    if (fallback !== null) {
      fallback.hidden = true;
    }
    element.setAttribute("data-island-ready", "");
  };
  createRoot(host).render(<KanbanIsland io={io} onReady={onReady} emitMove={emitMove} />);
}
