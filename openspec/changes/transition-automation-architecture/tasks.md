# Tasks

## 1. Specification and Baseline

- [x] Write clean-break architecture blueprint.
- [x] Create proposal, design, requirements, and execution tasks.
- [x] Map every old metadata, API, event, runtime stream, Desk, client, CLI, and test reference.

## 2. Predicate and Change Context

- [x] Implement `PredicateExpression` normalization and evaluation.
- [x] Replace shared condition consumers and query planning.
- [x] Implement touched versus semantic document change context.
- [x] Add predicate and change-context contract tests.

## 3. Automation

- [x] Replace Automation metadata with stable ids, trigger, touchedFields, changes, and runWhen.
- [x] Replace action-index identity with stable action ids.
- [x] Add causation, correlation, loop depth, and repeated-path protection.
- [x] Preserve atomic enqueue, retry, lease, idempotency, and dead-letter behavior.

## 4. Transition and Workflow

- [x] Implement pure Transition Policy with `allowWhen`.
- [x] Replace singular Workflow with named multi-workflow metadata.
- [x] Enforce unique workflow names and state-field ownership.
- [x] Replace Workflow events and available-action projection.
- [x] Implement resource-local runtime workflow definition streams.

## 5. Surfaces

- [x] Replace resource and Workflow administration APIs.
- [x] Replace Desk administration, form actions, and bulk transitions.
- [x] Replace browser client and CLI contracts.
- [x] Replace history, audit, assignment, notification, realtime, and Automation workflow identity handling.
- [x] Regenerate starter and examples.

## 6. Composite Commands and Cleanup

- [x] Implement explicit Domain Command transition intents.
- [x] Remove old metadata types, routes, reducers, runtime readers, clients, generated code, and tests.
- [x] Document the exact backup checkpoint, reset scope, verification, and reseed procedure for every upgraded environment without executing destructive operations.
- [x] Remove all readers, translators, replay paths, and projections for pre-cutover Workflow history.

## 7. Verification

- [x] Run targeted unit, application, adapter, CLI, and Desk tests.
- [x] Run `npm run check`.
- [x] Run the architecture-critical `npm run coverage` gate with branch coverage at least 93 percent and record the separate `npm run coverage:all` baseline.
- [x] Verify local runtime and Desk flows in the browser.
- [x] Audit every blueprint requirement against direct evidence.

## 8. Independent Review

- [x] Run a software architect expert subagent review against the blueprint and implementation.
- [x] Resolve every blocking finding and repeat review until PASS.
