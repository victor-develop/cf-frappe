/**
 * Typed Hono JSX server-component primitives for the Desk UI.
 *
 * Escaping model: hono/jsx escapes ALL text children and attribute values by
 * default. Components in this module therefore never call an HTML escaper.
 * The single sanctioned bypass is {@link UnsafeRawHtml}, which requires a
 * written `reason` so every raw-HTML sink stays auditable via grep.
 *
 * These primitives render to plain strings via {@link renderPage} (full
 * document) or `element.toString()` (fragment), so the existing
 * string-returning render functions in ../render.ts can delegate to JSX
 * incrementally, page by page, without signature changes.
 */
import type { Child, FC } from "hono/jsx";
import { html, raw } from "hono/html";
import { DESK_STYLES_PATH } from "./styles.js";

/** Minimal shape of a rendered hono/jsx element. */
export type DeskElement = { toString(): string | Promise<string> };

/** One link inside a sidebar navigation section. */
export type DeskNavItem = {
  readonly href: string;
  readonly label: string;
  readonly active?: boolean;
};

/** A labelled group of sidebar links ("Workspaces", "DocTypes", ...). */
export type DeskNavSection = {
  readonly heading: string;
  readonly items: readonly DeskNavItem[];
};

export type DeskLayoutProps = {
  readonly title: string;
  /** Precomputed navigation view-model; components never query services. */
  readonly navSections?: readonly DeskNavSection[];
  /** Optional flash message rendered as a status notice above the body. */
  readonly message?: string;
  readonly children?: Child;
};

const NavLinks: FC<{ items: readonly DeskNavItem[] }> = ({ items }) => (
  <>
    {items.map((item) => (
      <a class={`nav-link${item.active ? " is-active" : ""}`} href={item.href}>
        {item.label}
      </a>
    ))}
  </>
);

const Navigation: FC<{ sections: readonly DeskNavSection[] }> = ({ sections }) => (
  <>
    {sections
      .filter((section) => section.items.length > 0)
      .map((section) => (
        <>
          <p class="nav-heading">{section.heading}</p>
          <NavLinks items={section.items} />
        </>
      ))}
  </>
);

/**
 * Full Desk page chrome: head with stylesheet link, skip link, mobile header,
 * sidebar navigation, and the main column with topbar + notice. Mirrors the
 * semantics of render.ts renderDeskLayout.
 */
export const DeskLayout: FC<DeskLayoutProps> = ({ title, navSections = [], message, children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} - cf-frappe Desk</title>
      <link rel="stylesheet" href={DESK_STYLES_PATH} />
    </head>
    <body>
      <a class="skip-link" href="#main">
        Skip to content
      </a>
      <header class="mobile-shell-header">
        <a class="brand mobile-brand" href="/desk">
          cf-frappe
        </a>
        <details class="mobile-nav">
          <summary>Menu</summary>
          <nav>
            <Navigation sections={navSections} />
          </nav>
        </details>
      </header>
      <aside class="sidebar" aria-label="Desk navigation">
        <a class="brand" href="/desk">
          cf-frappe
        </a>
        <nav>
          <Navigation sections={navSections} />
        </nav>
      </aside>
      <main id="main" class="main">
        <header class="topbar">
          <div>
            <p class="kicker">Desk</p>
            <h1>{title}</h1>
          </div>
        </header>
        {message !== undefined && message !== "" ? (
          <p class="notice" role="status">
            {message}
          </p>
        ) : null}
        {children}
      </main>
    </body>
  </html>
);

export type PanelProps = {
  /** Optional element id (rendered before `class`, e.g. deep-link anchors). */
  readonly id?: string | undefined;
  /** Extra class fragment appended to `panel`, e.g. "printing-section". */
  readonly variant?: string | undefined;
  readonly title?: string | undefined;
  /**
   * Muted heading metadata (counts, versions, "Read only"). When set, the
   * heading renders as `div.form-head > h2 + p` instead of a bare `h2`.
   */
  readonly meta?: Child | undefined;
  readonly children?: Child;
};

/** Standard content card (`section.panel`) with an optional heading. */
export const Panel: FC<PanelProps> = ({ id, variant, title, meta, children }) => (
  <section id={id} class={variant !== undefined && variant !== "" ? `panel ${variant}` : "panel"}>
    {meta !== undefined ? (
      <div class="form-head">
        <h2>{title}</h2>
        <p>{meta}</p>
      </div>
    ) : title !== undefined ? (
      <h2>{title}</h2>
    ) : null}
    {children}
  </section>
);

export type ToolbarProps = { readonly children?: Child };

/** Top-of-page command strip (`section.toolbar`). */
export const Toolbar: FC<ToolbarProps> = ({ children }) => <section class="toolbar">{children}</section>;

export type DataTableColumn<Row> = {
  readonly key: string;
  readonly label: string;
  /** Cell renderer; defaults to reading `row[key]` when Row is a record. */
  readonly render?: (row: Row) => Child;
};

export type DataTableProps<Row> = {
  readonly columns: readonly DataTableColumn<Row>[];
  readonly rows: readonly Row[];
  /** Shown inside the table body when `rows` is empty. */
  readonly empty?: string;
  readonly caption?: string;
};

function defaultCell<Row>(row: Row, key: string): Child {
  const value = (row as Record<string, unknown>)[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Responsive Desk table. Every cell carries `data-label` (the column label)
 * to match the mobile card layout driven by the Desk stylesheet, mirroring
 * render.ts renderTableCell.
 */
export function DataTable<Row>({ columns, rows, empty, caption }: DataTableProps<Row>) {
  return (
    <table>
      {caption !== undefined ? <caption>{caption}</caption> : null}
      <thead>
        <tr>
          {columns.map((column) => (
            <th scope="col">{column.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && empty !== undefined ? (
          <tr>
            <td class="empty" colspan={columns.length}>
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr>
              {columns.map((column) => (
                <td data-label={column.label}>
                  {column.render ? column.render(row) : defaultCell(row, column.key)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

export type FieldProps = {
  readonly label: string;
  /** Extra class fragment appended to `field`, e.g. "wide" or "checkbox". */
  readonly variant?: string;
  /** Muted helper text rendered under the control. */
  readonly hint?: string;
  readonly children?: Child;
};

/** A labelled form control (`label.field` > `span` + control + hint). */
export const Field: FC<FieldProps> = ({ label, variant, hint, children }) => (
  <label class={variant !== undefined && variant !== "" ? `field ${variant}` : "field"}>
    <span>{label}</span>
    {children}
    {hint !== undefined ? <small>{hint}</small> : null}
  </label>
);

export type SelectOptionSpec = {
  readonly value: string;
  /** Visible option text; defaults to `value`. */
  readonly label?: string | undefined;
  readonly selected?: boolean | undefined;
};

/**
 * Option list for a native `<select>`.
 *
 * Rendered through hono's `html` tagged template (which escapes interpolated
 * values) instead of JSX attributes, because hono/jsx serializes boolean
 * attributes as `selected=""` while the Desk test suite asserts the bare
 * `<option value="A4" selected>` form byte-for-byte. Keep using this for any
 * converted view that marks a selected option.
 */
export const SelectOptions: FC<{ readonly options: readonly SelectOptionSpec[] }> = ({ options }) => (
  <>
    {options.map(
      (option) =>
        html`<option value="${option.value}"${option.selected === true ? raw(" selected") : raw("")}>${option.label ?? option.value}</option>`
    )}
  </>
);

export type FormRowProps = {
  /** Column count for the CSS grid (`div.fields.cols-N`); defaults to auto. */
  readonly columns?: 1 | 2 | 3 | 4;
  readonly children?: Child;
};

/** Grid row grouping several {@link Field}s (`div.fields`). */
export const FormRow: FC<FormRowProps> = ({ columns, children }) => (
  <div class={columns !== undefined ? `fields cols-${columns}` : "fields"}>{children}</div>
);

export type NoticeProps = {
  readonly tone?: "status" | "error";
  readonly children?: Child;
};

/** Inline flash message. `status` -> p.notice[role=status], `error` -> p.error[role=alert]. */
export const Notice: FC<NoticeProps> = ({ tone = "status", children }) =>
  tone === "error" ? (
    <p class="error" role="alert">
      {children}
    </p>
  ) : (
    <p class="notice" role="status">
      {children}
    </p>
  );

export type ActionBarProps = { readonly children?: Child };

/** Horizontal button/command row (`div.actions`). */
export const ActionBar: FC<ActionBarProps> = ({ children }) => <div class="actions">{children}</div>;

export type EmptyStateProps = { readonly message: string };

/** Panel-wrapped empty placeholder, mirroring render.ts renderNotFound. */
export const EmptyState: FC<EmptyStateProps> = ({ message }) => (
  <section class="panel">
    <p class="empty">{message}</p>
  </section>
);

export type ErrorStateProps = { readonly message: string };

/** Panel-wrapped error alert, mirroring render.ts renderErrorPanel. */
export const ErrorState: FC<ErrorStateProps> = ({ message }) => (
  <section class="panel">
    <p class="error" role="alert">
      {message}
    </p>
  </section>
);

export type UnsafeRawHtmlProps = {
  /**
   * REQUIRED audit trail: why this HTML is safe to inject verbatim (e.g.
   * "output of renderListView, escaped internally via escapeHtml"). Never
   * pass user-controlled content through this component.
   */
  readonly reason: string;
  readonly html: string;
};

/**
 * The ONLY sanctioned raw-HTML escape hatch in the Desk UI.
 *
 * hono/jsx escapes children and attributes by default; this component
 * bypasses that for trusted, pre-escaped markup (legacy string renderers
 * during incremental migration). A non-empty `reason` is enforced at runtime
 * so unauthenticated bypasses fail loudly in tests.
 */
export const UnsafeRawHtml: FC<UnsafeRawHtmlProps> = ({ reason, html }) => {
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new Error("UnsafeRawHtml requires a non-empty audit reason");
  }
  return raw(html);
};

/**
 * Renders a JSX element to a complete HTML document string (doctype +
 * markup). Bridges JSX pages back into the existing string-returning render
 * pipeline. Async components are not supported in this phase; they would
 * yield a Promise and are rejected explicitly.
 */
export function renderPage(element: DeskElement): string {
  const markup = element.toString();
  if (typeof markup !== "string") {
    throw new Error("renderPage does not support async components; render synchronously");
  }
  return `<!doctype html>\n${markup}`;
}

/** Renders a JSX element to an HTML fragment string (no doctype). */
export function renderFragment(element: DeskElement): string {
  const markup = element.toString();
  if (typeof markup !== "string") {
    throw new Error("renderFragment does not support async components; render synchronously");
  }
  return markup;
}
