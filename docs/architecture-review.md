# Standalone Architecture Review

Date: 2026-06-28

Reviewer: standalone subagent with the requested DRY, extreme separation-of-concerns, TDD, reactive functional-first, data-model-driven, event-modeling, and event-sourcing-first lens.

## Verdict

Fail for the original success criteria.

The current project has a strong event-sourced metadata kernel and broad Cloudflare adapter coverage, but it does not yet pass the requested architecture-quality bar. The review also confirmed the full project goal remains incomplete because the test count is still below the Frappe reference target.

## Findings

- `DocumentService` is too broad. It owns command authorization, validation, link reads, naming, uniqueness, hooks, lifecycle, merge, comments, sharing, assignments, tags, followers, and event construction in one large service.
- The central event payload union in `src/core/types.ts` is too large and makes every bounded feature edit the same core event type.
- Uniqueness reservations and document writes are event-sourced, but they are not committed through one multi-stream atomic command boundary.
- After-commit delivery intents can now be persisted to a durable document delivery outbox when the composed delivery hook is installed, but notification, email, and realtime consumers still need a complete retry worker path before this can be considered event-sourcing-first end to end.
- D1 event insertion logic is duplicated between generic event-store and document-store adapters.
- Test coverage is meaningful for the implemented kernel but remains below the stated Frappe parity target.

## Strengths

- Document writes use event streams as the write authority.
- D1 document commits batch immutable event insertion with projection updates.
- DocType metadata validation and registry reference checks are centralized.
- Tests assert domain event names separately from reducer payload kinds.

## Next Fixes

- Split `DocumentService` into narrower command policies and orchestration boundaries.
- Replace the monolithic event payload union with bounded event modules or a registry/type-map pattern.
- Introduce a multi-stream command commit and outbox abstraction for uniqueness reservations, assignment rules, notifications, and realtime delivery.
- Deduplicate D1 event append serialization behind one shared event writer.
- Finish durable event/outbox consumers for after-commit effects with retry, idempotency, and Worker/Queue integration tests.
- Continue raising test parity through real adapter and cross-surface contract coverage.

## Post-Review Progress

- Added a shared D1 event writer for event sequencing and `cf_frappe_events` insert serialization, now used by both `D1EventStore` and `D1DocumentStore`.
- Added focused adapter tests for the shared writer so the DRY fix is covered directly, while existing D1 document/event store tests continue to cover behavior through the public ports.
- Extracted pure document field mutation policy from `DocumentService` into `src/application/document-field-policy.ts`, covering readonly, allow-on-submit, unset safety, child-row origin validation, read-only child table value preservation, internal child-row field stripping, and duplicate/amend copy shaping behind focused unit tests.
- Extracted pure document collaboration policy from `DocumentService` into `src/application/document-collaboration-policy.ts`, covering comment, activity, assignment, tag, follower, share grant, share-user, and delegated-share normalization/authorization rules behind focused unit tests.
- Added `DocumentStore.commitBatch` and wired document create/update unique-value reservations plus the document event through one multi-stream commit, with D1 and in-memory adapters committing all event streams and projections atomically and focused tests proving failed unique commands no longer leave compensating reservation events.
- Added an event-sourced document delivery outbox for after-commit notification, realtime, and email delivery intents, with idempotent enqueue, claim/fail/retry/deliver folds, stale-claim protection, composed hook coverage, and deterministic tests.
