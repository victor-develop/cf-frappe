# Transition and Automation Architecture Replacement

## Why

The current singular Workflow, query-oriented condition model, and legacy Automation trigger shape duplicate concepts and prevent named multi-workflow modeling. The framework needs one deterministic Predicate Kernel, explicit pre-commit Transition Policy, named Workflow metadata, and durable post-commit Automation effects.

## Scope

- Replace `ListFilterExpression` as the shared condition model with `PredicateExpression`.
- Introduce one before/after document change context.
- Replace Automation metadata with stable ids, `trigger`, `touchedFields`, semantic `changes`, and `runWhen`.
- Replace singular Workflow with named multi-workflow metadata and resource-local runtime definitions.
- Add transition predicates, workflow-qualified events, APIs, Desk controls, browser clients, and CLI commands.
- Add explicit composite Domain Command transition intents.
- Remove old metadata, APIs, runtime stream reads, event reducers, persisted Workflow history, clients, fixtures, and compatibility logic.

## Non-Goals

- BPMN, Saga, distributed transactions, arbitrary scripts, or exactly-once delivery.
- Migration, translation, or replay of pre-cutover Workflow definitions, API payloads, historical Workflow events, or their projections.
- Compatibility adapters or mixed-version operation for old Workflow, Automation, API, or event contracts.

## Success Criteria

- Every requirement and scenario in `specs/transition-automation/spec.md` passes.
- Every task in `tasks.md` is complete with direct evidence.
- `npm run check` and the architecture-critical `npm run coverage` gate pass with branch coverage at least 93 percent; `npm run coverage:all` reports the full-source baseline separately.
- Browser/runtime verification proves Desk and transition workflows work locally.
- An independent software architect subagent reviews the final implementation against the blueprint and returns PASS with no blocking findings.
