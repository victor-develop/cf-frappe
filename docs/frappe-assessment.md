# Frappe Assessment And cf-frappe Parity Map

## Assessment

Frappe's core productivity loop is metadata-driven application assembly:

- A DocType is the main unit of model definition and captures fields, naming, list/form behavior, permissions, and persistence intent.
- Document APIs make each DocType available through uniform read and write operations.
- Hooks and controller methods let apps add behavior around lifecycle boundaries.
- Role-based permissions are model-level configuration rather than scattered handler code.
- REST resources expose documents through predictable `/api/resource/...` endpoints.

That model is powerful, but it is not event-sourcing first. cf-frappe keeps the metadata center and shifts the persistence contract:

- commands decide whether a change is allowed
- command decisions fold current state from the event stream
- accepted changes are stored as immutable domain events
- current document state is a projection
- Durable Objects are the intended command serialization boundary
- D1 stores event streams and queryable projections in a single command commit batch

## Current Equivalence

| Capability | Frappe | cf-frappe current state |
| --- | --- | --- |
| Metadata model | DocTypes | `defineDocType` |
| Naming series | autoname and naming_series | field/provided/uuid strategies plus event-stream-backed series counters |
| Field validation | DocField rules | built-in field types, required, min/max, select options |
| Link fields | Link DocFields | registered DocType targets, event-stream existence checks, generated option lookup API, and Desk select controls |
| Child tables | Table DocFields and child DocTypes | `type: "table"` fields backed by child DocType row validation, nested link checks, and Desk row grids |
| Default values | DocField defaults | scalar and function defaults |
| Permissions | roles, permission rules, and user permissions | role/action/predicate rules plus event-sourced linked-record user permissions |
| Document lifecycle | docstatus draft/submitted/cancelled | first-class submit/cancel events with command-side status guards |
| Lifecycle behavior | hooks/controllers | registry hooks: `beforeValidate`, `validate`, `afterCommit` |
| REST resources | `/api/resource/:doctype` | generated Hono routes with metadata-configured list views, operator-aware filters, and resolved filter-builder metadata |
| Desk views | list/form views from metadata | generated server-rendered `/desk` list/forms with model-defined form sections, columns, list columns, saved filters, operator-aware filters, filter-builder metadata, and page size |
| Print formats | printable document views | metadata-defined printable document pages, letterheads, and escaped templates |
| Reports | Report DocType/query reports | metadata-defined report columns, typed filters, row ordering, summaries, charts, saved definitions, CSV exports, HTTP/Desk report-builder APIs, and Desk pages |
| Audit trail | document versioning/activity | permissioned timelines with field diffs, comments, activity feed entries, assignments, tags, followers, admin audit search, and deleted-document recovery projected from append-only events plus model-declared domain commands |
| Current reads | SQL document tables | D1/in-memory projections plus metadata-planned D1 indexes |
| Migrations | patches and schema migrations | D1 migration plans, rendered SQL bundles, and applied checksum journal |
| Workflow | Workflow DocType | metadata transitions and transition events |
| Background jobs | scheduler and queue workers | `JobRegistry`, queue dispatch/consume, Cron mapping, schedule admin, D1-backed execution history, and failed-job retry admin |
| File attachments | File DocType plus file store | `File` metadata DocType plus R2/in-memory `FileStorage` and generated Desk file manager |
| Realtime notifications | `publish_realtime`/Socket.IO | document commit events over Durable Object WebSocket topics with tenant, DocType, and document fan-out plus redacted user-recipient notifications |
| Session auth | sessions | signed cookie actor resolver, optional event-sourced account/login routes, and env-backed Worker composition |
| Cloudflare runtime | not native | Worker, D1, Durable Object command routing |
| Apps | installed apps and hooks | `defineApp` manifests composed into one registry with dependency-ordered hooks |
| Client scripts | form/list scripts | same-origin `defineClientScript` bundles plus a generated Desk browser API with basic form event hooks |
| App starter | bench/new app setup | initial `cf-frappe init` scaffold with Worker, D1, Durable Object, and signed-session wiring |

## Current Gaps

- Generated Desk UI now covers basic list/form/report/print pages, model-defined form sections and field order, list columns, default list filters, saved user filters, operator-aware filter controls, resolved filter-builder metadata, link-field select controls, child table row grids, submit/cancel lifecycle actions, metadata workflow transition actions, document timelines with field diffs/comments/assignments/tags/followers, user-permission administration, typed report filters, report row ordering, event-sourced saved report definitions with HTTP and Desk report-builder APIs, report summaries/charts/exports with metadata-driven ordering/palette/value-label controls, custom print templates, reusable letterheads, same-origin client script injection with a built-in browser API, basic form event hooks, parsed realtime subscriptions, and page size. Richer visual filter builders, richer report-builder controls, broader admin tools, advanced chart controls, and broader browser-side client APIs are not implemented.
- DocType metadata now plans and applies D1 projection-index migrations with a checksum journal, and app manifests compose DocTypes/hooks/reports/print formats, but destructive/renaming migrations, data backfills, and CLI-driven app installation are still future work.
- Background jobs now have Queue/Cron support plus schedule admin, D1-backed execution history with API/Desk admin dashboards, manual schedule dispatch, and failed-execution retry actions, but worker pools and richer scheduler controls are not implemented.
- Document history now exposes permissioned timeline entries with bounded event-sourced field-level old/new diffs, comment events, activity feed entries, assignment events, tag events, follower events, admin-only audit search, and deleted-document audit recovery from the event stream.
- Realtime notifications now have Durable Object WebSocket tenant, DocType, and document topics plus redacted user-recipient notifications with Desk client helpers, but presence, richer Desk consumption, and durable replay are not implemented.
- Auth providers remain adapter seams; signed cookie actor resolution and event-sourced account/login routes exist, but password reset, email verification, richer Desk user administration, and provider-specific integrations are still future work.
- User permissions now restrict reads, link options, link validation, and existing-document commands from event-sourced per-user grants, with admin API and Desk management over the same event stream plus model-backed grant validation.
- File storage now has basic R2-backed attachments plus generated Desk upload/list/download/delete workflows, but multipart chunking, presigned browser uploads, virus scanning hooks, image transforms, and richer file manager views are not implemented.
- The CLI now creates a Cloudflare-ready starter app and generated code uses app manifests, but it does not yet install third-party app packages, generate model migrations after app changes, run data backfills, or set up auth providers.
- Test volume is intentionally focused on the new kernel and is not close to Frappe's project-wide test count.

## Design Direction

The next stage should preserve the current dependency direction:

1. Keep domain decisions and event creation in pure TypeScript.
2. Add platform integrations only through ports and adapters.
3. Grow metadata into UI/report/job/migration generators without coupling those surfaces to D1 directly.
4. Treat Durable Objects as command routers, not as the source of all model logic.
5. Add contract tests for every new adapter before adding more generated features.

## Completion Bar For The Original Goal

The original goal asks for Frappe-like ease, a public GitHub repository, an independent architecture review, and a test suite no smaller than the old framework. This repository is not at that bar yet. Current evidence proves the first architectural slice is working, not that the full goal is complete.
