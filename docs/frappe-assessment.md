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
| Permissions | roles, permission rules, user permissions, and DocShare | role/action/predicate rules plus event-sourced linked-record user permissions and document-stream share grants |
| Document sharing | DocShare | per-document share/revoke events folded into read/update/share overlays, HTTP routes, timelines, audit search, and user notifications |
| Document lifecycle | docstatus draft/submitted/cancelled | first-class submit/cancel events with command-side status guards |
| Lifecycle behavior | hooks/controllers | registry hooks: `beforeValidate`, `validate`, `afterCommit` |
| REST resources | `/api/resource/:doctype` | generated Hono routes with metadata-configured list views, operator-aware filters, and resolved filter-builder metadata |
| Desk views | list/form views from metadata | generated server-rendered `/desk` list/forms with model-defined form sections, columns, list columns, saved filters, operator-aware filters, filter-builder metadata, and page size |
| Print formats | printable document views | metadata-defined printable document pages, letterheads, and escaped templates |
| Reports | Report DocType/query reports | metadata-defined report columns, typed filters, row ordering, summaries, charts, saved definitions, CSV exports, HTTP/Desk report-builder APIs, and Desk pages |
| Audit trail | document versioning/activity | permissioned timelines with field diffs, comments, activity feed entries, assignments, tags, followers, admin audit search, and deleted-document recovery projected from append-only events plus model-declared domain commands |
| Current reads | SQL document tables | D1/in-memory projections plus metadata-planned D1 indexes |
| Migrations | patches and schema migrations | D1 migration plans, rendered SQL bundles, applied checksum journal, and app-declared data patches with applied journals plus API/Desk/CLI status, apply, and enqueue controls with optional bounds |
| Workflow | Workflow DocType | metadata transitions and transition events |
| Background jobs | scheduler and queue workers | `JobRegistry`, queue dispatch/consume, Cron mapping, tenant-scoped event-sourced runtime schedule definitions with explicit Worker trigger catalogs plus enable/disable/reset overrides, D1-backed execution history, and failed-job retry admin |
| File attachments | File DocType plus file store | `File` metadata DocType plus R2/in-memory `FileStorage`, direct upload reservation/finalization APIs, file scan hooks, generated record attachment panels, and Desk file manager |
| Notification logs | Notification Log | event-sourced per-user inbox streams with generated HTTP and Desk read/dismiss workflows |
| Realtime notifications | `publish_realtime`/Socket.IO | document commit events over Durable Object topics with tenant, DocType, document, and redacted user-topic fan-out plus permissioned presence snapshots, generated Desk presence panels, and bounded durable replay |
| Session auth | sessions | signed cookie and Cloudflare Access actor resolvers, optional event-sourced account/profile/login/recovery routes, and env-backed Worker composition |
| Cloudflare runtime | not native | Worker, D1, Durable Object command routing |
| Apps | installed apps and hooks | `defineApp` manifests composed into one registry with dependency-ordered hooks |
| Client scripts | form/list scripts | same-origin `defineClientScript` bundles plus a generated Desk browser API with basic form event hooks, field controls, and feedback helpers |
| App starter | bench/new app setup | initial `cf-frappe init` scaffold with Worker, D1, Durable Object, signed-session wiring, and `cf-frappe install` package-manager/dependency/app-registry wiring |

## Current Gaps

- Generated Desk UI now covers basic list/form/report/print pages, generated Admin navigation, model-defined form sections and field order, list columns, default list filters, saved user filters, operator-aware filter controls, resolved filter-builder metadata, link-field select controls, child table row grids, submit/cancel lifecycle actions, metadata workflow transition actions, document timelines with field diffs/comments/assignments/tags/followers/share events, document share controls, role administration, user-permission administration, user-account administration, durable notification inbox read/dismiss workflows, typed report filters, report row ordering, event-sourced saved report definitions with HTTP and Desk report-builder APIs, report summaries/charts/exports with metadata-driven ordering/palette/value-label controls, custom print templates, reusable letterheads, same-origin client script injection with a built-in browser API, document collaboration and saved-filter client helpers, basic form event hooks, field controls, user feedback helpers, parsed realtime subscriptions, snapshot-backed document presence panels, and page size. Richer visual filter builders, richer report-builder controls, broader admin tools, advanced chart controls, and broader browser-side client APIs beyond the current metadata/resource/report/collaboration/realtime surface are not implemented.
- DocType metadata now plans and applies D1 projection-index migrations with retired-index drops and a checksum journal, app manifests compose DocTypes/hooks/reports/print formats/data patches, and the CLI can save app dependency metadata, run detected package managers for lockfile/node_modules updates, wire app modules into generated registries, generate reviewable D1 migration files after versioned DocType index changes, and drive remote data-patch status/apply/enqueue operations through the same admin API as Desk. Basic app-declared data patches/backfills have D1 and in-memory applied journals plus admin API/Desk/CLI status and apply routes with bounded and single-patch execution, and queue-backed apply jobs let admins enqueue validated patch plans through Cloudflare Queues. Event-level destructive/renaming data migrations, richer patch workflow controls, and auth-provider setup are still future work.
- Background jobs now have Queue/Cron support, registry-declared worker pools with batch-lane concurrency and pool retry defaults, schedule admin, tenant-scoped event-sourced runtime schedule definitions, explicit Worker trigger catalogs, enable/disable/reset overrides, D1-backed execution history with API/Desk admin dashboards, manual schedule dispatch, and failed-execution retry actions.
- Document history now exposes permissioned timeline entries with bounded event-sourced field-level old/new diffs, comment events, activity feed entries, assignment events, tag events, follower events, share events, admin-only audit search, and deleted-document audit recovery from the event stream.
- Realtime notifications now have Durable Object tenant, DocType, document, and user topics plus redacted user-recipient realtime notifications, while durable notification logs are folded from separate per-user event streams with HTTP and Desk read/dismiss events. Permissioned presence snapshots through HTTP, Desk client helpers, generated Desk document presence panels, and bounded durable replay exist, but live collaborative editing UI is not implemented.
- Auth providers remain adapter seams; signed cookie and Cloudflare Access actor resolution, event-sourced role catalogs, optional catalog-backed account role validation, event-sourced account/profile/login/recovery routes, generic password reset and email verification token flows, self/admin profile updates, profile preference fields, and basic Desk account/profile administration exist, but additional provider integrations and provider sync are still future work.
- User permissions now restrict reads, link options, link validation, and existing-document commands from event-sourced per-user grants, with admin API and Desk management over the same event stream plus model-backed grant validation. Document shares now add per-record read/update/share overlays from the document stream, with HTTP and Desk management routes.
- File storage now has basic R2-backed attachments plus permission-aware HTTP metadata listing/update, direct browser upload reservation/finalization APIs behind the `FileStorage` signer boundary, event-sourced file scan hooks, generated record attachment panels, and Desk upload/list/metadata/download/delete workflows, but multipart chunking, image transforms, and richer file manager views are not implemented.
- The CLI now creates a Cloudflare-ready starter app, saves app package metadata, runs detected package managers to update lockfiles and `node_modules`, wires app modules into the generated registry, generates reviewable D1 migration files after versioned DocType index changes, and can inspect, apply, or enqueue deployed app patches through remote admin API routes with literal or environment-backed headers. Auth-provider setup and richer operator workflows remain future work.
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
