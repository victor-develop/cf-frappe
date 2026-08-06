# Verification Evidence

This record audits the transition and Automation architecture blueprint against the clean-break implementation. It does not authorize or execute any destructive reset. Environment cutover remains subject to the operator approval boundary in `docs/transition-automation-cutover.md`.

## Command Evidence

Verified on 2026-08-05 from the repository working tree:

| Command | Result |
| --- | --- |
| `npm run check` | PASS: typecheck, 244 Vitest files, 2,897 tests, and production build |
| `npm run coverage` | PASS: 94.95% statements, 93.70% branches, 98.82% functions, 95.41% lines over the architecture-critical modules in `vitest.config.ts` |
| `npm run coverage:all` | PASS: full-source baseline of 90.89% statements, 82.15% branches, 97.52% functions, and 90.80% lines |
| `git diff --check` | PASS |

The full-source baseline is intentionally reported separately and is not represented as satisfying the scoped 93% architecture gate.

## Requirement Audit

| Blueprint requirement | Direct implementation evidence | Direct test evidence | Status |
| --- | --- | --- | --- |
| One bounded deterministic Predicate Kernel | `src/core/predicates.ts`; Predicate consumption in `src/core/automation-rules.ts`, `src/core/assignment-rules.ts`, `src/core/notification-rules.ts`, `src/core/schema.ts`, `src/core/workflow.ts`, and projection planners | `tests/core/predicates.test.ts`, `tests/core/automation-rules.test.ts`, `tests/core/notification-rules.test.ts`, `tests/core/schema.test.ts`, `tests/adapters/d1-projection-store.test.ts` | PASS |
| Touched writes are distinct from semantic before/after changes | `src/core/document-change.ts`; one change context is supplied to Automation planning by `src/application/document-service.ts` | `tests/core/document-change.test.ts`, `tests/core/automation-rules.test.ts`, `tests/application/document-service.test.ts` | PASS |
| Ordinary field changes can trigger Automation without Workflow metadata | `AutomationTriggerDefinition` is event/change based in `src/core/types.ts`; matching is independent of Workflow in `src/core/automation-rules.ts` | `tests/core/automation-rules.test.ts`, `tests/application/automation-run-service.test.ts` | PASS |
| Automation effects are atomically registered, idempotent, retryable, loop-bounded, and dead-lettered | `src/application/automation-run-service.ts`, `src/application/automation-run-events.ts`, `src/application/automation-run-consumer.ts`; source commits include Automation Run appends in `src/application/document-service.ts` | `tests/application/automation-run-service.test.ts`, `tests/application/automation-run-events.test.ts`, `tests/application/automation-run-consumer.test.ts`, `tests/application/automation-run-policy.test.ts` | PASS |
| A DocType supports multiple named workflows with unique state-field ownership | `DocTypeDefinition.workflows` and named definitions in `src/core/types.ts`; normalization and ownership in `src/core/workflow.ts`; runtime ownership validation in `src/application/workflow-service.ts` | `tests/core/workflow.test.ts`, `tests/application/workflow-service.test.ts` | PASS |
| Transition Policy enforces path, role, predicate, version, and exact controlled-field mutation before commit | `src/application/document-command-policy.ts`, `src/application/document-field-policy.ts`, `src/application/document-service.ts` | `tests/application/document-command-policy.test.ts`, `tests/application/document-service.test.ts` | PASS |
| Available actions use the authoritative unredacted document while preserving authorization and field visibility boundaries | `QueryService.listAvailableWorkflowActions` in `src/application/query-service.ts`; Desk delegates action projection to this service | `tests/application/query-service.test.ts`, `tests/desk/desk-app.test.ts` | PASS |
| Runtime Workflow saves validate administrator-visible state fields and known enabled roles | `WorkflowService.save` and its role resolver in `src/application/workflow-service.ts`; Cloudflare and Desk composition wire the Role Catalog | `tests/application/workflow-service.test.ts`, `tests/application/workflow-policy.test.ts` | PASS |
| Workflow identity is qualified across events, runtime definitions, API, Desk, client, CLI, history, audit, assignment, notification, realtime, and Automation Runs | `src/application/document-command-events.ts`, `src/application/workflow-events.ts`, `src/adapters/http/workflow-api.ts`, `src/adapters/http/resource-api.ts`, `src/adapters/desk/app.ts`, `src/adapters/desk/client.ts`, `src/cli/workflows.ts`, `src/cli/resources.ts`, history/audit/rule projections, and Automation Run event state | Workflow HTTP/Desk/client/CLI suites; `tests/application/document-history-policy.test.ts`; `tests/core/notification-rules.test.ts`; `tests/application/automation-run-service.test.ts` | PASS |
| Runtime named Workflow edits use resource-local optimistic concurrency | Resource-local stream identity and expected versions in `src/core/streams.ts`, `src/application/workflow-events.ts`, and `src/application/workflow-service.ts` | `tests/application/workflow-events.test.ts`, `tests/application/workflow-service.test.ts` | PASS |
| Composite Domain Commands require explicit transition intents and commit all controlled fields atomically | `DomainCommandTransitionIntent` in `src/core/types.ts`; planning in `src/application/document-command-policy.ts`; atomic commit, unique reservation, and projection in `src/application/document-service.ts` | Composite success, failure, direct-write rejection, and unique reservation/release cases in `tests/application/document-command-policy.test.ts` and `tests/application/document-service.test.ts` | PASS |
| In-memory and D1 Predicate semantics agree, including explicit `null`, missing values, `in`, and `not_in` | `src/adapters/in-memory/list-filters.ts`, `src/adapters/d1/projection-query.ts`, `src/core/predicates.ts` | `tests/adapters/d1-projection-store.test.ts`, `tests/adapters/in-memory.test.ts`, shared predicate fixtures | PASS |
| Singular Workflow metadata and removed Automation contracts fail instead of being adapted | `DocTypeDefinition` exposes only `workflows`; Automation exposes stable ids, `trigger`, `runWhen`, and stable action ids | `tests/core/schema.test.ts`, `tests/core/workflow.test.ts`, `tests/core/automation-rules.test.ts` | PASS |
| Removed unqualified Workflow routes and pre-cutover Workflow definition history are not read or translated | Only workflow-qualified resource and administration routes remain; runtime folds resource-local new-contract streams | `tests/http/workflow-api.test.ts`, `tests/application/workflow-service.test.ts`, `tests/application/workflow-events.test.ts` | PASS |
| No rolling compatibility, default mapping, upcaster, old-history migration, or conversion utility is shipped | Clean-break contract in `docs/transition-automation-architecture-blueprint.md`; operator-only replacement procedure in `docs/transition-automation-cutover.md`; replacement inventory in `inventory.md` | Removed-contract rejection tests above | PASS |
| Generated starter and public examples use named Workflow and new Automation contracts | `src/cli/templates.ts`, `examples/todos/models.ts` | `tests/cli/doctypes.test.ts`, `tests/cli/resources.test.ts`, `tests/cli/workflows.test.ts` | PASS |
| Test count is no smaller than the recorded Frappe static-marker reference | `docs/test-parity.md` records the reproducible comparison method | 2,897 passing Vitest cases versus the recorded Frappe count of 2,784 | PASS |
| Independent architecture review has no blocking findings | Review was performed by a separate read-only software architect subagent against the actual working tree | Sixth fresh review returned `VERDICT: PASS` with no blocking findings | PASS |

## Previous Review Remediation

The first independent review returned seven blocking findings. The current audit maps each remediation to direct evidence:

1. Coverage claims now distinguish the scoped 93% gate from the honest full-source baseline.
2. Available Workflow actions reload and evaluate the authoritative projection instead of a redacted DTO.
3. List-filter DTOs normalize directly into `PredicateExpression`; no second internal condition tree is returned by query planning.
4. Runtime Workflow saves validate field visibility and known enabled roles.
5. Composite Domain Commands reserve and release unique values in the same atomic commit.
6. Durable Automation Runs snapshot Workflow name, action, and transition identities.
7. D1 explicit-null and missing-field behavior matches the in-memory Predicate evaluator.

The later independent reviews recorded below completed the final architecture acceptance gate.

## Second Review Remediation

The second independent review found seven additional issues. Each now has direct regression evidence:

1. Pre-cutover `WorkflowTransitioned` payloads are rejected by D1 deserialization and ignored by document folding and history projection; no upcaster or translator was added.
2. Runtime state-field ownership uses per-field ownership streams, and Workflow definition plus claim/release events commit atomically across streams. Same-field races conflict while unrelated fields remain independently writable.
3. Saved filter events and aggregate state persist only one optional `PredicateExpression`. Flat `filters[]` and `ListFilterExpression` remain external query/presentation DTOs and are never a second persisted condition tree.
4. QueryService applies deleted-state, record-permission, and user-permission filtering before final pagination and visible totals.
5. D1 text predicates that SQLite cannot evaluate with matching Unicode semantics use a bounded shared-evaluator post-filter; exact predicates remain safely parameterized and pushed down.
6. Automation run and loop identities escape tuple components deterministically, preventing delimiter collisions.
7. Registry construction rejects unknown Automation target DocTypes, unknown or controlled patch fields, permanent read-only fields, and invalid literal values before delivery.

The third independent review found two blockers. D1 negation now uses the bounded shared-evaluator post-filter so missing and explicit-null semantics cannot diverge through SQLite `NOT`. Saved filters now persist only one optional Predicate tree, while direct explicit query DTOs preserve their caller-provided grouping when no saved filter participates.

The fourth independent review confirmed both fixes and found one additional boundary issue: saved-filter inputs could exceed the shared Predicate node budget before persistence. `SavedListFilterService.save` now normalizes the complete combined Predicate at the persistence boundary, regardless of adapter. Regression evidence covers both an oversized flat input and two individually bounded flat/expression inputs whose combined tree exceeds the budget; both are rejected without appending an event.

The sixth fresh independent review confirmed all remediation and returned `VERDICT: PASS` with no blocking findings.
