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
| Field validation | DocField rules | built-in field types, required, min/max, select options |
| Default values | DocField defaults | scalar and function defaults |
| Permissions | roles and permission rules | role/action/predicate rules |
| Lifecycle behavior | hooks/controllers | registry hooks: `beforeValidate`, `validate`, `afterCommit` |
| REST resources | `/api/resource/:doctype` | generated Hono routes |
| Audit trail | document versioning/activity | append-only events plus model-declared domain commands |
| Current reads | SQL document tables | D1/in-memory projections plus metadata-planned D1 indexes |
| Workflow | Workflow DocType | metadata transitions and transition events |
| Cloudflare runtime | not native | Worker, D1, Durable Object command routing |

## Current Gaps

- Generated Desk UI, forms, list views, report builder, print views, and admin tools are not implemented.
- DocType metadata currently plans D1 projection indexes, but does not yet manage a full migration lifecycle.
- Background jobs, scheduler events, realtime notifications, and WebSocket channels are not implemented.
- Auth providers and session management are intentionally left as adapter seams; no default trusted resolver is provided.
- File storage and attachments should use R2 but are not implemented.
- There is no installable CLI yet.
- Test volume is intentionally focused on the new kernel and is not close to Frappe's project-wide test count.

## Design Direction

The next stage should preserve the current dependency direction:

1. Keep domain decisions and event creation in pure TypeScript.
2. Add platform integrations only through ports and adapters.
3. Grow metadata into UI/report/job generators without coupling those surfaces to D1 directly.
4. Treat Durable Objects as command routers, not as the source of all model logic.
5. Add contract tests for every new adapter before adding more generated features.

## Completion Bar For The Original Goal

The original goal asks for Frappe-like ease, a public GitHub repository, an independent architecture review, and a test suite no smaller than the old framework. This repository is not at that bar yet. Current evidence proves the first architectural slice is working, not that the full goal is complete.
