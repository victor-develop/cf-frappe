# Desk UI Architecture

Status: Phase 1 (rendering foundation) of the Hono JSX migration described in
[issue #19](https://github.com/victor-develop/cf-frappe/issues/19).

Desk is server-first: native links, forms, POST-Redirect-GET, and full-page
SSR are the default interaction model. This document defines the conventions
introduced by the JSX foundation and the contracts later phases must follow.

## Module layout

| Path | Role |
| --- | --- |
| `src/adapters/desk/ui/primitives.tsx` | Typed Hono JSX server components shared by every migrated page (`DeskLayout`, `Panel`, `DataTable`, `FormRow`, `Field`, `Notice`, `ActionBar`, `EmptyState`, `ErrorState`, `UnsafeRawHtml`) plus `renderPage`/`renderFragment` string bridges. |
| `src/adapters/desk/ui/styles.ts` | The Desk stylesheet as an independently testable string asset (`deskCss()`), served at `DESK_STYLES_PATH` (`/desk/styles.css`) with `cache-control: public, max-age=3600`. Pages reference it via `<link rel="stylesheet">`; CSS is no longer inlined per page. |
| `src/adapters/desk/render.ts` | Legacy string renderers. Signatures are frozen; pages migrate off this file incrementally by delegating to JSX components internally, page by page. |
| `src/adapters/desk/app.ts` | Hono routes. Handlers stay focused on request parsing, authorization-aware service calls, and typed view-model construction — never HTML concatenation. |
| `src/adapters/desk/client.ts` | Legacy generated browser script. Untouched in this phase; replaced by real TypeScript modules in a later phase. |

TypeScript is configured with `"jsx": "react-jsx"` and
`"jsxImportSource": "hono/jsx"` (tsconfig.json / tsconfig.build.json). No new
runtime dependency was added; the JSX runtime ships inside the existing
`hono` package.

## Server component conventions

- Components are **pure functions of their props**. They must not read
  request state, call services, perform I/O, or consult globals.
- Components are **synchronous**. Async components are rejected by
  `renderPage`/`renderFragment` on purpose; data loading happens in the route
  handler before rendering.
- Use `class` (not `className`) — hono/jsx accepts standard HTML attribute
  names.
- Preserve the existing Desk CSS vocabulary (`panel`, `fields`, `field`,
  `actions`, `notice`, `error`, `empty`, `nav-link`, `data-label` table
  cells). Primitives encode these classes so pages do not hand-write them.
- Keep accessibility semantics from the string renderers: skip link,
  `role="status"` / `role="alert"` on notices, `aria-label` on landmarks,
  `scope="col"` on table headers, labelled form controls.
- New shared components belong in `src/adapters/desk/ui/`; page-specific
  components live next to the page module once pages are split out of
  `render.ts` (phase 3).

## View-model boundary

The target flow (issue #19):

```text
Hono route
  -> application/query service
  -> typed page view model
  -> Hono JSX SSR component
```

Rules:

- Route handlers build a **plain, serializable view model** (already
  permission-filtered, already formatted where formatting is business logic)
  and pass it to a component. Components never receive service objects,
  registries, or the raw `Request`.
- Authentication, authorization, field visibility, validation, workflow
  rules, and business state remain **server-enforced** before the view model
  is constructed. A component cannot re-derive or weaken a permission
  decision — it only renders what it is given.
- URL construction stays in the view-model layer (route handlers / href
  builders) using `encodeURIComponent`; components treat hrefs as opaque
  strings. Never place personal or sensitive data in query strings.
- During migration, string renderers may delegate to JSX internally via
  `renderPage`/`renderFragment` **without changing their exported
  signatures**, so `app.ts` and tests are untouched until a page is fully
  migrated.

## Escaping and the raw-HTML escape hatch

- hono/jsx escapes **all text children and attribute values by default**.
  Migrated components must not call `escapeHtml` — double-escaping is a bug.
- `UnsafeRawHtml` in `primitives.tsx` is the **single sanctioned bypass**. It
  requires a non-empty `reason` prop (enforced at runtime) describing why the
  markup is trusted, so every raw sink is auditable with
  `grep -rn "UnsafeRawHtml" src/`.
- Legitimate uses: bridging legacy pre-escaped fragments from `render.ts`
  during incremental migration, and intentionally raw print-template output.
  Never pass user-controlled content through it.
- Do not use hono's `raw()`/`html` helpers or `dangerouslySetInnerHTML`
  directly in page code; route through `UnsafeRawHtml` so review and security
  tests have one choke point.

## CSS asset

- `deskCss()` returns the stylesheet (content kept byte-identical to the
  former inline version). `createDeskApp` serves it at
  `GET /desk/styles.css` with `text/css; charset=utf-8` and a one-hour public
  cache.
- `renderDeskLayout` (and the JSX `DeskLayout`) emit
  `<link rel="stylesheet" href="/desk/styles.css">` instead of an inline
  `<style>` block, shrinking every page response and making the stylesheet
  cacheable and testable in isolation.

## Island ownership rules

Islands are implemented (phase 5). Per issue #19 architecture decisions 4–11
they follow this contract:

1. React islands only for surfaces with substantial client-side state
   (Kanban drag-and-drop, nested filter/report builders, workflow
   visualization, child-table editing, realtime collaboration). Everything
   else stays native HTML + small typed enhancements.
2. No React mount over the whole Desk main area. Each island has an explicit,
   narrow DOM boundary, its own entry point, and a lazy-loaded bundle.
3. Server enforcement is unchanged: islands consume the same permission-aware
   APIs as every other client and cannot weaken authorization.
4. Island bootstrap attributes carry **IDs and permission-aware API URLs**,
   not large or sensitive document snapshots embedded in HTML.
5. Hono JSX server components and React client components live in **separate
   compilation contexts** (separate tsconfigs, JSX runtimes, dependency
   graphs). Neither leaks types or imports across the boundary.
6. No React SSR or hydration: Hono JSX owns server HTML; React mounts
   client-only via `createRoot` at declared island boundaries.
7. Islands communicate with the page through **typed DOM events or server
   APIs** — no Desk-wide React root, React router, or global client store.
8. Non-island pages must not download React or React DOM. Shared runtime
   chunks and island chunks are lazy, cache-safe, and measured.

## Island authoring guide

### Module layout and pipeline

| Path | Role |
| --- | --- |
| `src/adapters/desk/islands-src/` | React island sources. Compiled by `tsconfig.islands.json` (`jsx: react-jsx`, `jsxImportSource: react`); every `.tsx` file also carries a `/** @jsxImportSource react */` pragma so vitest/esbuild transform it with the React runtime. The server tsconfigs exclude this directory — hono/jsx and React JSX never share a compilation context. |
| `islands-src/loader.ts` + `loader-main.ts` | Framework-free loader. Scans `[data-cf-frappe-island]` mounts and dynamic-imports ONLY islands declared in the build-time manifest (injected via esbuild `define`), so markup can never make it fetch arbitrary modules. |
| `islands-src/vendor.ts` | Vendor anchor entry. Forces react / react-dom / react-jsx-runtime into a shared, content-hashed vendor chunk that island entries import, so React downloads once and stays cached across island releases. |
| `islands-src/islands/<name>.tsx` | One entry per island exporting `default (element: HTMLElement) => void`, which parses the mount attributes and calls `createRoot` (client-only; no SSR/hydration). |
| `islands-src/events.ts` | Typed CustomEvent map for island -> page communication (`islandEvent(...)` dispatched on the mount element). |
| `src/adapters/desk/ui/islands.tsx` | Server-side primitives: `IslandMount` (declared boundary + bootstrap `data-island-*` attributes + `[data-island-fallback]` SSR fallback) and `IslandLoaderScript`. |
| `src/adapters/desk/islands-bundle.generated.ts` | Generated by `npm run build:client` (scripts/build-desk-client.mjs): hashed asset map, loader file name, and island manifest. Served at `GET /desk/islands/<hashed-file>` with `cache-control: public, max-age=31536000, immutable`. Drift is CI-guarded by `npm run check:client-fresh`. |

### Register a new island

1. Create `islands-src/islands/<name>.tsx` with a `default` mount function;
   keep the React component and its pure logic in separate modules so logic
   is unit-testable without the DOM.
2. Add the island to `ISLAND_ENTRIES` in `scripts/build-desk-client.mjs` and
   run `npm run build:client` (regenerates the manifest + assets).
3. In the page view, wrap the server-rendered fallback in
   `<IslandMount name="<name>" props={...}>` and emit `<IslandLoaderScript />`
   from that page ONLY. The generated `DESK_ISLAND_ENTRIES` type makes
   unknown island names a compile error.

### Secure an island

- Bootstrap props are IDs and permission-aware API URLs only. `IslandMount`
  rejects JSON-looking or oversized values at render time; the Kanban island
  additionally refuses non-same-origin bootstrap URLs at mount time. Never
  embed document snapshots in mount attributes.
- Islands call the same permission-enforced endpoints as every other client
  (`/api/...` for reads, the Desk form/transition endpoints for writes, with
  `expectedVersion` optimistic concurrency). The server stays the authority:
  optimistic UI must roll back on rejection and reconcile by re-fetching.
- The loader imports only manifest-declared chunks; the asset route serves
  only exact own-keys of the generated asset map.

### Test an island

- Pure logic + loader: plain vitest in the `desk-islands` project
  (happy-dom), `tests/desk-islands/*.test.ts`.
- Components: `react-dom/client` + `act` in `tests/desk-islands/*.test.tsx`
  (set `IS_REACT_ACT_ENVIRONMENT`). New island modules hold the same >=93%
  branch coverage bar as the typed client core (`vitest.config.ts` include
  list).
- Bundle isolation: `tests/desk/desk-islands.test.ts` asserts non-island
  pages contain zero island/React script bytes and the mount + loader appear
  only on island pages. Extend it when adding an island page.
- Journeys: Playwright specs in `tests/browser/` (see
  `kanban-island.spec.ts`) cover pointer/keyboard interaction, persistence
  after reload, and mobile viewports.

### Style an island

Reuse the existing Desk CSS vocabulary (`kanban-column`, `kanban-card`,
`empty`, `muted`, ...) so the enhanced UI matches the SSR fallback; add
island-specific classes (`kanban-card-grabbed`, `kanban-column-target`,
`visually-hidden` live regions) to `src/adapters/desk/ui/styles.ts`. Islands
must stay keyboard-accessible: focusable controls, arrow/enter/escape
semantics, and `aria-live` announcements for every state change.

### The Kanban island

`islands/kanban.tsx` progressively enhances `/desk/kanbans/:kanban`:

- Bootstrap: `data-island-run-url` (`/api/kanban/<board>/run`) and
  `data-island-doctype-meta-url` (`/api/meta/doctypes/<doctype>`).
- Moves: when a workflow owns the board's `columnField`, a card move posts
  the matching `POST /desk/:doctype/:name/workflows/:workflow/transition/:action`
  (the exact endpoint the document form uses); otherwise it posts a plain
  field update to `POST /desk/:doctype/:name`. Impossible transitions are
  announced and never posted.
- Interaction: HTML5 drag-and-drop plus a keyboard grab/target/drop model
  (Enter/Space to grab, arrows to pick a column, Enter to drop, Escape to
  cancel) with polite `aria-live` announcements.
- Fallback: without JavaScript the server-rendered read-only board and the
  document form remain fully usable.
- Page integration: successful moves dispatch the typed
  `cf-frappe:kanban-move` CustomEvent on the mount element.

## Verification expectations

- `npx tsc --noEmit`, `npx tsc -p tsconfig.client.json --noEmit`, and
  `npx tsc -p tsconfig.islands.json --noEmit` must all stay clean (the three
  compilation contexts: server hono/jsx, typed client core, React islands).
- `tests/desk/ui-primitives.test.tsx` covers the primitives, the
  default-escaping guarantee, the `UnsafeRawHtml` reason enforcement, and the
  stylesheet route.
- Existing exact-markup assertions in `tests/desk/*.test.ts` define the
  compatibility bar for migrated pages: attribute order, void-tag forms, and
  entity encoding must match, or the tests are updated deliberately alongside
  the page migration.
