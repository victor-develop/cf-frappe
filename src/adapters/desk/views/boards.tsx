import type { FC } from "hono/jsx";
import { type CalendarDefinition } from "../../../core/calendar.js";
import { type CalendarRunResult } from "../../../application/calendar-service.js";
import { type KanbanCardResult, type KanbanRunResult } from "../../../application/kanban-service.js";
import { type KanbanDefinition } from "../../../core/kanban.js";
import { IslandLoaderScript, IslandMount } from "../ui/islands.js";
import { renderFragment } from "../ui/primitives.js";
import { slug } from "./shared.js";

export function renderKanbanList(kanbans: readonly KanbanDefinition[]): string {
  return renderFragment(<KanbanList kanbans={kanbans} />);
}

const KanbanList: FC<{ kanbans: readonly KanbanDefinition[] }> = ({ kanbans }) => (
  <section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead>
          <tr>
            <th>Kanban</th>
            <th>DocType</th>
            <th>Column Field</th>
            <th>Module</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {kanbans.length === 0 ? (
            <tr>
              <td colspan={5} class="empty">No readable kanban boards.</td>
            </tr>
          ) : (
            kanbans.map((kanban) => (
              <tr>
                <td data-label="Kanban">
                  <a href={`/desk/kanbans/${encodeURIComponent(kanban.name)}`}>{kanban.label ?? kanban.name}</a>
                </td>
                <td data-label="DocType">{kanban.doctype}</td>
                <td data-label="Column Field">{kanban.columnField}</td>
                <td data-label="Module">{kanban.module ?? ""}</td>
                <td data-label="Description">{kanban.description ?? ""}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </section>
);

export function renderKanbanView(result: KanbanRunResult): string {
  return renderFragment(<KanbanView result={result} />);
}

const KanbanView: FC<{ result: KanbanRunResult }> = ({ result }) => (
  <>
    {result.board.description ? <p class="muted">{result.board.description}</p> : null}
    <section class="toolbar board-toolbar">
      <a class="button primary" href={`/desk/${encodeURIComponent(result.board.doctype)}/new`}>New {result.board.doctype}</a>
      <a class="button" href={`/desk/${encodeURIComponent(result.board.doctype)}`}>List</a>
      <a class="button" href={`/desk/kanbans/${encodeURIComponent(result.board.name)}`}>Refresh</a>
      <span class="board-mode">Moves load as an enhancement; without JavaScript, open a card to edit it</span>
    </section>
    <IslandMount
      name="kanban"
      props={{
        board: result.board.name,
        "run-url": `/api/kanban/${encodeURIComponent(result.board.name)}/run`,
        "doctype-meta-url": `/api/meta/doctypes/${encodeURIComponent(result.board.doctype)}`
      }}
    >
      <section class="kanban-board">
        {result.columns.length === 0 ? (
          <p class="empty">No kanban columns.</p>
        ) : (
          result.columns.map((column) => (
            <section class="kanban-column">
              <header>
                <h2>{column.label}</h2>
                <span>{String(column.total)}</span>
              </header>
              {column.cards.length === 0 ? (
                <p class="empty">No cards.</p>
              ) : (
                column.cards.map((card) => <KanbanCard card={card} />)
              )}
              {column.hasMore ? <p class="muted">More cards hidden by board limit.</p> : null}
            </section>
          ))
        )}
      </section>
    </IslandMount>
    <IslandLoaderScript />
  </>
);

const KanbanCard: FC<{ card: KanbanCardResult }> = ({ card }) => {
  const priority =
    typeof card.data.priority === "string" && card.data.priority.length > 0 ? card.data.priority : undefined;
  return (
    <a class="kanban-card" href={`/desk/${encodeURIComponent(card.doctype)}/${encodeURIComponent(card.name)}`}>
      <strong>{card.title}</strong>
      <span>{card.name}</span>
      <div class="kanban-card-meta">
        {priority !== undefined ? (
          <span class={`value-chip value-chip-${slug(priority) || "value"}`}>{priority}</span>
        ) : null}
        <span class="status-pill">{card.docstatus}</span>
        <small>v{String(card.version)} · {card.updatedAt}</small>
      </div>
    </a>
  );
};

export function renderCalendarList(calendars: readonly CalendarDefinition[]): string {
  return renderFragment(<CalendarList calendars={calendars} />);
}

const CalendarList: FC<{ calendars: readonly CalendarDefinition[] }> = ({ calendars }) => (
  <section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead>
          <tr>
            <th>Calendar</th>
            <th>DocType</th>
            <th>Start Field</th>
            <th>End Field</th>
            <th>Module</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {calendars.length === 0 ? (
            <tr>
              <td colspan={6} class="empty">No readable calendars.</td>
            </tr>
          ) : (
            calendars.map((calendar) => (
              <tr>
                <td data-label="Calendar">
                  <a href={`/desk/calendars/${encodeURIComponent(calendar.name)}`}>{calendar.label ?? calendar.name}</a>
                </td>
                <td data-label="DocType">{calendar.doctype}</td>
                <td data-label="Start Field">{calendar.startField}</td>
                <td data-label="End Field">{calendar.endField ?? ""}</td>
                <td data-label="Module">{calendar.module ?? ""}</td>
                <td data-label="Description">{calendar.description ?? ""}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </section>
);

export function renderCalendarView(result: CalendarRunResult): string {
  return renderFragment(<CalendarView result={result} />);
}

const CalendarView: FC<{ result: CalendarRunResult }> = ({ result }) => (
  <>
    {result.calendar.description ? <p class="muted">{result.calendar.description}</p> : null}
    {result.from === undefined && result.to === undefined ? null : (
      <p class="muted">Window {result.from ?? "beginning"} to {result.to ?? "end"}</p>
    )}
    <section class="calendar-list">
      <header>
        <h2>{result.calendar.label ?? result.calendar.name}</h2>
        <span>{String(result.total)}</span>
      </header>
      {result.events.length === 0 ? (
        <p class="empty">No events.</p>
      ) : (
        result.events.map((event) => (
          <a class="calendar-event" href={`/desk/${encodeURIComponent(event.doctype)}/${encodeURIComponent(event.name)}`}>
            <time>{event.start}{event.end === undefined ? "" : ` to ${event.end}`}</time>
            <strong>{event.title}</strong>
            <span>{event.name}{event.color === undefined ? "" : ` - ${event.color}`}</span>
            <small>v{String(event.version)} updated {event.updatedAt}</small>
          </a>
        ))
      )}
      {result.hasMore ? <p class="muted">More events hidden by calendar limit.</p> : null}
    </section>
  </>
);
