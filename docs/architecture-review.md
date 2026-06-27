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
- After-commit hook failures are best-effort through the hook error callback, so notification, assignment, and realtime side effects need a durable outbox/retry path before this can be considered event-sourcing-first end to end.
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
- Convert after-commit effects to durable event/outbox consumers with retry and idempotency tests.
- Continue raising test parity through real adapter and cross-surface contract coverage.
