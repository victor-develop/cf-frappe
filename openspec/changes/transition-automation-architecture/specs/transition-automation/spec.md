# Transition and Automation Requirements

## Requirement: Shared Predicate Kernel

The framework SHALL use one bounded, deterministic `PredicateExpression` model for document conditions.

### Scenario: Predicate evaluation across consumers

- Given the same normalized document values and predicate
- When query filtering, conditional fields, notification rules, assignment rules, automation rules, and transition policies evaluate it
- Then they produce the same boolean result for supported scopes and operators.

### Scenario: Predicate safety

- Given an invalid path, unsupported scope, type-incompatible operator, or over-limit expression
- When metadata is registered or saved
- Then validation rejects it before command or effect execution.

## Requirement: Document Change Context

The framework SHALL calculate touched fields and semantic before/after changes once per document command.

### Scenario: Same-value write

- Given a command submits a field with its existing normalized value
- When Automation selectors are evaluated
- Then `touchedFields` may match and semantic `changes` does not match.

### Scenario: Unset

- Given a command unsets an existing field
- When the change context is calculated
- Then before, after, touched fields, changed fields, and the changes map are correct.

## Requirement: Durable Automation

Automation Rules SHALL use stable rule/action ids, explicit triggers, semantic change selectors, optional `runWhen`, and durable at-least-once effects.

### Scenario: Atomic registration

- Given a source document change matches an Automation Rule
- When the source command commits
- Then the source event and resolved Automation Run are committed atomically.

### Scenario: Reliable retry

- Given an Automation effect fails transiently
- When the run is drained again after its retry time
- Then it retries without duplicating an already-applied target update.

### Scenario: Loop control

- Given Automation rules form a causal cycle
- When the configured depth or repeated path limit is reached
- Then the run stops and records an operator-visible terminal outcome.

## Requirement: Named Multi-Workflow

A DocType SHALL support multiple named workflows with unique field ownership.

### Scenario: Independent dimensions

- Given a Task has `lifecycle` and `review` workflows on different fields
- When authorized transitions are executed
- Then each workflow changes only its owned field and emits its own workflow identity.

### Scenario: Duplicate ownership

- Given two workflows claim the same state field
- When metadata is registered or saved
- Then validation rejects the definitions.

### Scenario: Cross-workflow predicate

- Given a review transition requires lifecycle state `Done`
- When lifecycle is not `Done`
- Then the review transition is rejected before commit.

## Requirement: Transition Policy

Transition Policy SHALL enforce state path, authorization, predicate, expected version, and exact controlled-field mutation before commit.

### Scenario: Direct mutation

- Given an API, Desk, import, bulk, merge, Automation, or Domain Command update patches a controlled field without a transition plan
- When the command is validated
- Then it is rejected and no event is committed.

### Scenario: Available action parity

- Given an actor and document snapshot
- When available actions are projected and an action is executed without intervening change
- Then the execution decision matches the projection decision.

## Requirement: Workflow-Qualified Surfaces

Events, runtime definitions, API, Desk, browser client, CLI, history, audit, notifications, assignments, and Automation selectors SHALL carry workflow identity.

### Scenario: Qualified API transition

- Given workflow `review` and action `approve`
- When the workflow-qualified resource route is called
- Then the framework transitions `review` and cannot resolve an action from another workflow.

### Scenario: Runtime concurrency

- Given two administrators edit unrelated named workflow definitions
- When both save with their resource-local expected versions
- Then neither edit conflicts with the other.

## Requirement: Composite Domain Commands

Domain Commands SHALL declare explicit transition intents for every controlled-field change.

### Scenario: Atomic composite transition

- Given a Domain Command declares two valid transition intents
- When it executes
- Then both controlled fields and the primary Domain Command event commit atomically.

### Scenario: Composite failure

- Given one of several transition intents is invalid
- When the Domain Command executes
- Then no controlled field, event, or Automation Run is committed.

## Requirement: Clean Break

The new architecture SHALL not contain compatibility, migration, translation, or replay behavior for removed contracts.

### Scenario: Removed metadata

- Given singular Workflow or old Automation condition metadata
- When the registry loads it
- Then compilation or validation fails rather than adapting it.

### Scenario: Fresh-state cutover

- Given an operator-approved reset of old Workflow definitions, Workflow events, and affected projections
- When migrations and seeds run
- Then the generated starter and Desk operate only on the new event and runtime definition shapes.

### Scenario: Old Workflow history

- Given pre-cutover Workflow events or projected Workflow history
- When the new runtime starts
- Then it does not read, translate, replay, or expose those records through the new Workflow surfaces.

### Scenario: Mixed-version deployment

- Given an old Workflow writer or reader remains deployed
- When cutover readiness is evaluated
- Then deployment is blocked until the old component is removed and the reset/reseed boundary is approved.
