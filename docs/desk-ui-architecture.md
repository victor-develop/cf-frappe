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

## Island ownership rules (contract for later phases)

Islands are **not implemented yet**. Per issue #19 architecture decisions
4–11, when they arrive they must follow this contract:

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

## Verification expectations

- `npx tsc --noEmit` must stay clean (JSX config covers `src/**/*.tsx` and
  `tests/**/*.tsx`).
- `tests/desk/ui-primitives.test.tsx` covers the primitives, the
  default-escaping guarantee, the `UnsafeRawHtml` reason enforcement, and the
  stylesheet route.
- Existing exact-markup assertions in `tests/desk/*.test.ts` define the
  compatibility bar for migrated pages: attribute order, void-tag forms, and
  entity encoding must match, or the tests are updated deliberately alongside
  the page migration.
