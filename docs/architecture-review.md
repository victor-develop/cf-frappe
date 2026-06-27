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
- After-commit delivery intents can now be persisted to a durable document delivery outbox and drained through Worker/Queue composition in generated starters, but broader integration and operational coverage is still needed before this can be considered fully proven end to end.
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
- Broaden durable delivery outbox integration tests across realtime, email, retry, and starter deployment flows.
- Continue raising test parity through real adapter and cross-surface contract coverage.

## Post-Review Progress

- Added a shared D1 event writer for event sequencing and `cf_frappe_events` insert serialization, now used by both `D1EventStore` and `D1DocumentStore`.
- Added focused adapter tests for the shared writer so the DRY fix is covered directly, while existing D1 document/event store tests continue to cover behavior through the public ports.
- Extracted pure document field mutation policy from `DocumentService` into `src/application/document-field-policy.ts`, covering readonly, allow-on-submit, unset safety, child-row origin validation, read-only child table value preservation, internal child-row field stripping, and duplicate/amend copy shaping behind focused unit tests.
- Extracted pure document collaboration policy from `DocumentService` into `src/application/document-collaboration-policy.ts`, covering comment, activity, assignment, tag, follower, share grant, share-user, and delegated-share normalization/authorization rules behind focused unit tests.
- Added `DocumentStore.commitBatch` and wired document create/update unique-value reservations plus the document event through one multi-stream commit, with D1 and in-memory adapters committing all event streams and projections atomically and focused tests proving failed unique commands no longer leave compensating reservation events.
- Added an event-sourced document delivery outbox for after-commit notification, realtime, and email delivery intents, with idempotent enqueue, claim/fail/retry/deliver folds, stale-claim protection, composed hook coverage, and deterministic tests.
- Added a platform-neutral document delivery outbox consumer plus a built-in drain job wrapper, covering handler dispatch, retry scheduling, notification/realtime/queued-email delivery adapters, and job execution with focused tests.
- Wired the durable delivery outbox into Cloudflare Worker/Queue composition and starter scaffolding, so generated apps can record after-commit delivery intents in the aggregate coordinator and drain them through the built-in queue job.
- Introduced a `DomainEventPayloadMap` extension point and moved document delivery outbox event payloads into their own bounded application event module, proving the path away from one central `DocumentEventPayload` union with a focused contract test.
- Moved email notification outbox event payloads into their own bounded application event module and narrowed `EmailNotificationService` internals to that payload type, adding a second extension-map contract test.
- Moved user notification inbox event payloads into their own bounded application event module and narrowed read/dismiss helpers to that payload type, adding a third extension-map contract test.
- Moved saved list filter event payloads into their own bounded application event module and narrowed the service event factory to that payload type, adding a fourth extension-map contract test.
- Moved saved report event payloads into their own bounded application event module and narrowed the service event factory to that payload type, adding a fifth extension-map contract test.
- Moved role catalog event payloads into their own bounded application event module and narrowed `RoleService` append/fold orchestration to that payload type, adding a sixth extension-map contract test.
- Moved print settings event payloads into their own bounded application event module and typed `PrintSettingsService` event creation to that payload, adding a seventh extension-map contract test.
- Moved user profile event payloads into their own bounded application event module and typed `UserProfileService` event creation to that payload, adding an eighth extension-map contract test.
- Moved user account, auth-provider, password-recovery, email-verification, role-change, and account-enabled event payloads into their own bounded application event module and narrowed `UserAccountService` append helpers to that payload union, adding a ninth extension-map contract test.
- Moved job schedule override, pause, clear, runtime-save, and runtime-delete event payloads into their own bounded application event module and typed `JobScheduleService` event creation to that payload union, adding a tenth extension-map contract test.
- Moved custom field save and disable event payloads into their own bounded application event module and typed `CustomFieldService` event creation to that payload union, adding an eleventh extension-map contract test while preserving legacy per-DocType stream replay.
- Moved field property override save and clear event payloads into their own bounded application event module and narrowed `FieldPropertyService` append/fold orchestration to that payload union, adding a twelfth extension-map contract test.
- Moved workflow definition save and clear event payloads into their own bounded application event module and narrowed `WorkflowService` append/fold orchestration to that payload union, adding a thirteenth extension-map contract test.
- Moved notification rule save and clear event payloads into their own bounded application event module and narrowed `NotificationRuleService` append/fold orchestration to that payload union, adding a fourteenth extension-map contract test.
- Moved assignment rule save and clear event payloads into their own bounded application event module and narrowed `AssignmentRuleService` append/fold orchestration to that payload union, adding a fifteenth extension-map contract test.
- Moved linked-record user permission allow and revoke event payloads into their own bounded application event module and typed `UserPermissionService` event creation to that payload union, adding a sixteenth extension-map contract test.
