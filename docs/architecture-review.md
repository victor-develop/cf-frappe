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
- Moved document share and share-revoke event payloads into their own bounded application event module and typed `DocumentService` share event creation to that payload union, adding a seventeenth extension-map contract test.
- Moved document comment, activity, assignment, tag, and follower event payloads into their own bounded application event module and typed `DocumentService` collaboration event creation to that payload union, adding an eighteenth extension-map contract test.
- Moved workflow transition and model-declared domain command event payloads into their own bounded application event module and typed `DocumentService` command event creation to that payload union, adding a nineteenth extension-map contract test.
- Extracted document lifecycle event payload helpers and the create-event snapshot projector from `DocumentService` into a pure application module, adding focused unit coverage for create, update, delete, submit, cancel, and projection behavior.
- Extracted document collaboration event payload helpers into the existing bounded collaboration event module and wired `DocumentService` comment, activity, assignment, tag, and follower commands through those helpers with focused unit coverage.
- Extracted workflow/domain-command and document-share event payload helpers into their bounded event modules and wired `DocumentService` transition, execute, share, and revoke-share commands through those helpers with focused unit coverage.
- Extracted unique-value reservation planning, scalar value canonicalization, active-owner checks, and release diffing from `DocumentService` into a pure application policy module with focused unit coverage while keeping multi-stream commit orchestration in the service.
- Extracted document naming strategy resolution, explicit-name validation for series DocTypes, naming-series rendering, and current-value parsing from `DocumentService` into a pure application policy module with focused unit coverage while keeping event-sourced series allocation in the service.
- Extracted bulk document selection normalization and per-document failure mapping from `DocumentService` into a pure application policy module with focused unit coverage while preserving the existing service import surface through re-exports.
- Extracted fetch-from path parsing, fetch-if-empty target checks, related DocType discovery, and child-row data guards from `DocumentService` into a pure document reference policy module with focused unit coverage while keeping event-stream reads and permission checks in the service.
- Extracted expected-version checks, merge-base validation, merge snapshot shaping, document-status guards, unset normalization, and model-declared command field picking from `DocumentService` into a pure document command policy module with focused unit coverage.
- Extracted tenant resolution and bulk single-command shaping from `DocumentService` into pure application policy helpers with focused unit coverage.
- Extracted recursive link validation and nested child-table issue path shaping from `DocumentService` into the document reference policy while keeping target reads and permission checks injected by the service.
- Extracted document action, visible-document, and linked-target access composition into a shared application access policy reused by document commands and document queries while services retain only share/grant retrieval.
- Extracted document query presentation shaping for CSV values, link labels, link searches, and global-search results from `QueryService` into a pure application policy with focused unit coverage.
- Extracted query input policy for list/search/CSV limits, search-term normalization, field lookup, link-field validation, and default-filter merging from `QueryService` with focused boundary coverage.
- Extracted fetch-from field enrichment from `DocumentService` into the document reference policy with injected readable-target lookup, covering create/update behavior, explicit-field preservation, fetch-if-empty, and unreadable targets.
- Extracted idempotent assignment/tag/follower collection change planning from `DocumentService` into the document collaboration policy with focused add/remove noop coverage.
- Extracted file naming, storage key, previewability, declared-size, direct-upload expiry, and rendition content-type planning from `FileService` into a pure file policy module with focused boundary coverage.
- Extracted multipart manifest parsing, part-size detection, reservation bounds, completion manifest matching, and R2-compatible part-size checks from `FileService` into the file policy with focused coverage.
- Extracted persisted rendition manifest parsing, view projection, transform option serialization, source/overlay matching, deterministic rendition id generation, and pending/failed/completed manifest transitions from `FileService` into the file policy with focused coverage.
- Extracted selected-file bulk operation normalization from `FileService` into the file policy, covering trimming, duplicates, expected-version validation, empty selections, and the bounded 100-file limit.
- Extracted direct-upload object metadata matching and scanner result patch shaping from `FileService` into the file policy with focused size/content-type and optional scan-field coverage.
- Extracted file dashboard row projection and limit normalization from `FileService` into the file policy with focused preview, attachment, scan, rendition, and limit coverage.
- Extracted buffered file content length calculation, required/optional file snapshot string reads, expected-version checks, and scan-failure error shaping from `FileService` into the file policy with focused boundary coverage.
- Extracted file downloadability, direct-upload and multipart-upload state guards, multipart upload id reads, and delete expected-version rules from `FileService` into the file policy with focused state-machine coverage.
- Extracted file document payload construction, upload completion/failure patch shaping, and multipart-completion state patches from `FileService` into the file policy with focused event-input coverage.
- Extracted buffered-upload final document data shaping from `FileService` into the file policy so scanner success/failure create events share one pure payload boundary.
- Extracted optional scan-result patch planning from `FileService` into the file policy so buffered, direct, and multipart upload flows share the same no-scanner empty-patch semantics.
- Extracted rendition manifest patch shaping from `FileService` into the file policy so rendition reservation/completion/failure commands reuse one pure document patch boundary.
- Extracted multipart part manifest patch shaping from `FileService` into the file policy so part-upload commands reuse the same pure manifest write boundary as manifest parsing/upserts.
- Extracted file metadata patch construction from `FileService` into the file policy with focused rename, privacy, attach, detach, and empty-patch coverage.
- Extracted file dashboard query normalization and list-filter mapping from `FileService` into the file policy with focused trimming, boolean, equality, and contains-filter coverage.
- Extracted file scanner target construction and scanner result-status validation from `FileService` into the file policy with focused default content-type and invalid-status coverage.
- Extracted available-rendition reuse selection and duplicate pending-rendition rejection from `FileService` into the file policy with focused source and overlay identity coverage.
- Centralized file transformability rejection in the file policy so direct transforms, persisted renditions, and overlay-source transforms share one tested content-type guard.
- Moved upload byte-limit checks and reservation-expiry timestamp planning into file policy so buffered, direct, and multipart upload flows share the same tested boundary rules.
- Extracted rendition download selection and file object deletion key planning from `FileService` into file policy so content serving and cleanup share tested manifest semantics.
- Moved transform source and overlay-source shaping into file policy so transformer ports receive a single tested projection from stored file snapshots and objects.
- Centralized upload and rendition object storage custom-metadata construction in file policy so storage adapters receive one tested metadata contract.
- Shared file metadata patch presence validation between single-file and bulk metadata updates through the file policy.
- Centralized file object content-type fallback, transformability checks, and source-etag selection in file policy.
- Moved persisted rendition storage put-command construction into file policy, including filename, optional size, and storage metadata.
