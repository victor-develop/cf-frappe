import { type CalendarDefinition } from "../../../core/calendar.js";
import { type CalendarRunResult } from "../../../application/calendar-service.js";
import { type KanbanCardResult, type KanbanRunResult } from "../../../application/kanban-service.js";
import { type KanbanDefinition } from "../../../core/kanban.js";
import { escapeHtml, renderTableCell, slug } from "./shared.js";

export function renderKanbanList(kanbans: readonly KanbanDefinition[]): string {
  const rows = kanbans
    .map(
      (kanban) => `<tr>
        ${renderTableCell("Kanban", `<a href="/desk/kanbans/${encodeURIComponent(kanban.name)}">${escapeHtml(kanban.label ?? kanban.name)}</a>`)}
        ${renderTableCell("DocType", escapeHtml(kanban.doctype))}
        ${renderTableCell("Column Field", escapeHtml(kanban.columnField))}
        ${renderTableCell("Module", escapeHtml(kanban.module ?? ""))}
        ${renderTableCell("Description", escapeHtml(kanban.description ?? ""))}
      </tr>`
    )
    .join("");
  return `<section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Kanban</th><th>DocType</th><th>Column Field</th><th>Module</th><th>Description</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="empty">No readable kanban boards.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export function renderKanbanView(result: KanbanRunResult): string {
  const description = result.board.description
    ? `<p class="muted">${escapeHtml(result.board.description)}</p>`
    : "";
  const columns = result.columns
    .map((column) => `<section class="kanban-column">
      <header>
        <h2>${escapeHtml(column.label)}</h2>
        <span>${String(column.total)}</span>
      </header>
      ${column.cards.length === 0
        ? `<p class="empty">No cards.</p>`
        : column.cards.map((card) => renderKanbanCard(card)).join("")}
      ${column.hasMore ? `<p class="muted">More cards hidden by board limit.</p>` : ""}
    </section>`)
    .join("");
  return `${description}
  <section class="toolbar board-toolbar">
    <a class="button primary" href="/desk/${encodeURIComponent(result.board.doctype)}/new">New ${escapeHtml(result.board.doctype)}</a>
    <a class="button" href="/desk/${encodeURIComponent(result.board.doctype)}">List</a>
    <a class="button" href="/desk/kanbans/${encodeURIComponent(result.board.name)}">Refresh</a>
    <span class="board-mode">Read-only board</span>
  </section>
  <section class="kanban-board">${columns || `<p class="empty">No kanban columns.</p>`}</section>`;
}

function renderKanbanCard(card: KanbanCardResult): string {
  const priority = typeof card.data.priority === "string" && card.data.priority.length > 0
    ? `<span class="value-chip value-chip-${escapeHtml(slug(card.data.priority) || "value")}">${escapeHtml(card.data.priority)}</span>`
    : "";
  return `<a class="kanban-card" href="/desk/${encodeURIComponent(card.doctype)}/${encodeURIComponent(card.name)}">
    <strong>${escapeHtml(card.title)}</strong>
    <span>${escapeHtml(card.name)}</span>
    <div class="kanban-card-meta">
      ${priority}
      <span class="status-pill">${escapeHtml(card.docstatus)}</span>
      <small>v${String(card.version)} · ${escapeHtml(card.updatedAt)}</small>
    </div>
  </a>`;
}

export function renderCalendarList(calendars: readonly CalendarDefinition[]): string {
  const rows = calendars
    .map(
      (calendar) => `<tr>
        ${renderTableCell("Calendar", `<a href="/desk/calendars/${encodeURIComponent(calendar.name)}">${escapeHtml(calendar.label ?? calendar.name)}</a>`)}
        ${renderTableCell("DocType", escapeHtml(calendar.doctype))}
        ${renderTableCell("Start Field", escapeHtml(calendar.startField))}
        ${renderTableCell("End Field", escapeHtml(calendar.endField ?? ""))}
        ${renderTableCell("Module", escapeHtml(calendar.module ?? ""))}
        ${renderTableCell("Description", escapeHtml(calendar.description ?? ""))}
      </tr>`
    )
    .join("");
  return `<section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Calendar</th><th>DocType</th><th>Start Field</th><th>End Field</th><th>Module</th><th>Description</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="empty">No readable calendars.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export function renderCalendarView(result: CalendarRunResult): string {
  const description = result.calendar.description
    ? `<p class="muted">${escapeHtml(result.calendar.description)}</p>`
    : "";
  const windowLabel = result.from === undefined && result.to === undefined
    ? ""
    : `<p class="muted">Window ${escapeHtml(result.from ?? "beginning")} to ${escapeHtml(result.to ?? "end")}</p>`;
  const events = result.events
    .map((event) => `<a class="calendar-event" href="/desk/${encodeURIComponent(event.doctype)}/${encodeURIComponent(event.name)}">
      <time>${escapeHtml(event.start)}${event.end === undefined ? "" : ` to ${escapeHtml(event.end)}`}</time>
      <strong>${escapeHtml(event.title)}</strong>
      <span>${escapeHtml(event.name)}${event.color === undefined ? "" : ` - ${escapeHtml(event.color)}`}</span>
      <small>v${String(event.version)} updated ${escapeHtml(event.updatedAt)}</small>
    </a>`)
    .join("");
  return `${description}${windowLabel}<section class="calendar-list">
    <header><h2>${escapeHtml(result.calendar.label ?? result.calendar.name)}</h2><span>${String(result.total)}</span></header>
    ${events || `<p class="empty">No events.</p>`}
    ${result.hasMore ? `<p class="muted">More events hidden by calendar limit.</p>` : ""}
  </section>`;
}
