/** @jsxImportSource react */
/**
 * Kanban island React component (client-only; no SSR, no hydration).
 *
 * Progressive enhancement of the server-rendered board: cards become
 * focusable and draggable, moves post to the same Desk endpoints the
 * document form uses, updates are optimistic with rollback, and every state
 * change is announced through an `aria-live` region. The island renders
 * nothing (keeping the SSR fallback visible) until the permission-aware
 * APIs it bootstraps from have answered.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, ReactElement } from "react";
import type { KanbanMoveEventDetail } from "../events.js";
import type { KanbanIslandIo } from "../kanban-io.js";
import {
  adjacentColumnValue,
  applyOptimisticMove,
  cancelAnnouncement,
  columnLabel,
  dropAnnouncement,
  failureAnnouncement,
  grabAnnouncement,
  KANBAN_GRAB_INSTRUCTIONS,
  planKanbanMove,
  targetAnnouncement,
  type IslandKanbanBoard,
  type IslandKanbanCard,
  type KanbanMoveRules
} from "../kanban-logic.js";

const DRAG_MIME = "application/x-cf-frappe-kanban";

export interface KanbanIslandProps {
  readonly io: KanbanIslandIo;
  /** Called once when live data replaced the SSR fallback. */
  readonly onReady: () => void;
  /** Typed island -> page event sink (dispatches on the mount element). */
  readonly emitMove: (detail: KanbanMoveEventDetail) => void;
}

interface GrabState {
  readonly card: string;
  readonly from: string;
  readonly target: string;
}

export function KanbanIsland({ io, onReady, emitMove }: KanbanIslandProps): ReactElement | null {
  const [board, setBoard] = useState<IslandKanbanBoard | undefined>(undefined);
  const [rules, setRules] = useState<KanbanMoveRules | undefined>(undefined);
  const [grab, setGrab] = useState<GrabState | undefined>(undefined);
  const [dropTarget, setDropTarget] = useState<string | undefined>(undefined);
  const [announcement, setAnnouncement] = useState("");
  const [busy, setBusy] = useState(false);
  const readyRef = useRef(false);
  const focusCardRef = useRef<string | undefined>(undefined);
  const cardElementsRef = useRef(new Map<string, HTMLElement>());
  const instructionsId = useId();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loadedBoard = await io.loadBoard();
        const loadedRules = await io.loadMoveRules(loadedBoard.columnField);
        if (cancelled) {
          return;
        }
        setBoard(loadedBoard);
        setRules(loadedRules);
      } catch {
        // Keep the server-rendered fallback; the island stays inert.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [io]);

  useEffect(() => {
    if (board !== undefined && rules !== undefined && !readyRef.current) {
      readyRef.current = true;
      onReady();
    }
  });

  useEffect(() => {
    const name = focusCardRef.current;
    if (name === undefined) {
      return;
    }
    focusCardRef.current = undefined;
    cardElementsRef.current.get(name)?.focus();
  });

  const commitMove = useCallback(
    async (cardName: string, from: string, to: string) => {
      if (board === undefined || rules === undefined || busy) {
        return;
      }
      const card = board.columns
        .find((column) => column.value === from)
        ?.cards.find((item) => item.name === cardName);
      if (card === undefined) {
        return;
      }
      setGrab(undefined);
      setDropTarget(undefined);
      const plan = planKanbanMove({ board, rules, card, from, to });
      if (!plan.ok) {
        setAnnouncement(failureAnnouncement(card, plan.message));
        return;
      }
      const previous = board;
      focusCardRef.current = cardName;
      setBoard(applyOptimisticMove(board, cardName, from, to));
      setBusy(true);
      const outcome = await io.postMove(plan.url, plan.body);
      if (!outcome.ok) {
        setBoard(previous);
        setAnnouncement(failureAnnouncement(card, outcome.message));
        focusCardRef.current = cardName;
        setBusy(false);
        return;
      }
      setAnnouncement(dropAnnouncement(previous, card, to));
      emitMove({ board: board.name, doctype: board.doctype, card: cardName, from, to });
      try {
        const fresh = await io.loadBoard();
        setBoard(fresh);
        focusCardRef.current = cardName;
      } catch {
        // Optimistic state already matches the accepted move.
      }
      setBusy(false);
    },
    [board, rules, busy, io, emitMove]
  );

  if (board === undefined || rules === undefined) {
    return null;
  }

  /**
   * Grab/drop toggle shared by every activation path of the Move button.
   * Native `click` covers mouse, touch, raw Enter/Space on the button, AND
   * assistive technologies that synthesize click events (screen-reader
   * browse-mode activation, mobile double-tap).
   */
  const toggleGrab = (card: IslandKanbanCard, from: string): void => {
    const grabbed = grab !== undefined && grab.card === card.name;
    if (!grabbed) {
      setGrab({ card: card.name, from, target: from });
      setAnnouncement(grabAnnouncement(board, card, from));
    } else if (grab.target === grab.from) {
      setGrab(undefined);
      setAnnouncement(cancelAnnouncement(card));
    } else {
      void commitMove(card.name, grab.from, grab.target);
    }
  };

  /** Arrow/Escape handling while grabbed; Enter/Space activate natively as clicks. */
  const handleMoveButtonKeyDown = (event: KeyboardEvent<HTMLElement>, card: IslandKanbanCard): void => {
    const grabbed = grab !== undefined && grab.card === card.name;
    if (!grabbed) {
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const target = adjacentColumnValue(board, grab.target, event.key === "ArrowLeft" ? -1 : 1);
      setGrab({ ...grab, target });
      setAnnouncement(targetAnnouncement(board, card, target));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setGrab(undefined);
      setAnnouncement(cancelAnnouncement(card));
    }
  };

  const handleDragStart = (event: DragEvent<HTMLElement>, card: IslandKanbanCard, from: string): void => {
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ card: card.name, from }));
    event.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = (event: DragEvent<HTMLElement>, to: string): void => {
    event.preventDefault();
    setDropTarget(undefined);
    const raw = event.dataTransfer.getData(DRAG_MIME);
    if (raw === "") {
      return;
    }
    try {
      const payload = JSON.parse(raw) as { card?: unknown; from?: unknown };
      if (typeof payload.card === "string" && typeof payload.from === "string") {
        void commitMove(payload.card, payload.from, to);
      }
    } catch {
      // Ignore malformed drag payloads.
    }
  };

  return (
    <section className="kanban-board kanban-board-island" aria-label="Kanban board" data-island-view="kanban">
      <p id={instructionsId} className="kanban-island-instructions">
        Drag cards between columns, or use a card&apos;s Move button: {KANBAN_GRAB_INSTRUCTIONS}
      </p>
      <div className="kanban-island-columns">
        {board.columns.map((column) => {
          const isKeyboardTarget = grab !== undefined && grab.target === column.value;
          const isDropTarget = dropTarget === column.value;
          return (
            <section
              key={column.value}
              className={`kanban-column${isDropTarget || isKeyboardTarget ? " kanban-column-target" : ""}`}
              aria-label={`${column.label} column with ${String(column.total)} cards`}
              data-column-value={column.value}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(DRAG_MIME)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTarget(column.value);
                }
              }}
              onDragLeave={() => {
                setDropTarget((current) => (current === column.value ? undefined : current));
              }}
              onDrop={(event) => {
                handleDrop(event, column.value);
              }}
            >
              <header>
                <h2>{column.label}</h2>
                <span>{String(column.total)}</span>
              </header>
              {column.cards.length === 0 ? <p className="empty">No cards.</p> : null}
              {column.cards.map((card) => {
                const grabbed = grab !== undefined && grab.card === card.name;
                return (
                  <article
                    key={card.name}
                    className={`kanban-card kanban-card-island${grabbed ? " kanban-card-grabbed" : ""}`}
                    draggable
                    data-card-name={card.name}
                    data-card-column={column.value}
                    onDragStart={(event) => {
                      handleDragStart(event, card, column.value);
                    }}
                  >
                    <strong>{card.title}</strong>
                    <span>
                      <a href={`/desk/${encodeURIComponent(card.doctype)}/${encodeURIComponent(card.name)}`}>
                        {card.name}
                      </a>
                    </span>
                    <div className="kanban-card-meta">
                      {card.priority !== undefined ? <span className="value-chip">{card.priority}</span> : null}
                      <span className="status-pill">{card.docstatus}</span>
                      <small>
                        v{String(card.version)} · {card.updatedAt}
                      </small>
                    </div>
                    <button
                      type="button"
                      ref={(element) => {
                        if (element === null) {
                          cardElementsRef.current.delete(card.name);
                        } else {
                          cardElementsRef.current.set(card.name, element);
                        }
                      }}
                      className="kanban-card-move"
                      aria-label={`Move ${card.title}`}
                      aria-pressed={grabbed}
                      aria-describedby={instructionsId}
                      aria-disabled={busy}
                      onClick={() => {
                        toggleGrab(card, column.value);
                      }}
                      onKeyDown={(event) => {
                        handleMoveButtonKeyDown(event, card);
                      }}
                    >
                      Move
                    </button>
                    {grabbed ? (
                      <small className="kanban-card-target-hint">
                        Drop target: {columnLabel(board, grab.target)}
                      </small>
                    ) : null}
                  </article>
                );
              })}
              {column.hasMore ? <p className="muted">More cards hidden by board limit.</p> : null}
            </section>
          );
        })}
      </div>
      <p className="kanban-live visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
