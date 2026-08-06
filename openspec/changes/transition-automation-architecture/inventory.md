# Replacement Inventory

This inventory records the old architecture surfaces that must be replaced, not adapted.

## Core Metadata and Evaluation

- `src/core/types.ts`: singular Workflow, old Automation shape, shared `ListFilterExpression` condition types.
- `src/core/list-view.ts`: query expression normalization and in-memory condition evaluation.
- `src/core/schema.ts`: conditional field evaluation and singular Workflow defaults/protection assumptions.
- `src/core/registry.ts`: condition, Automation, and Workflow normalization.
- `src/core/workflow.ts`: singular Workflow state, normalization, available transitions, runtime fold.
- `src/core/automation-rules.ts`: old event/changedFields/condition shape and action-index identity.
- `src/core/assignment-rules.ts`, `src/core/notification-rules.ts`: shared condition consumers.

## Application Command and Event Boundaries

- `src/application/document-service.ts`: transition orchestration, Automation Run planning, Domain Command planning.
- `src/application/document-command-policy.ts`: singular transition policy and event planning.
- `src/application/document-field-policy.ts`: one protected Workflow state field.
- `src/application/document-command-events.ts`: Workflow event payload without workflow identity.
- `src/application/workflow-service.ts`, `workflow-events.ts`, `workflow-policy.ts`: one definition per DocType and tenant-wide stream concurrency.
- `src/application/automation-run-service.ts`, `automation-run-consumer.ts`: run planning and idempotency metadata.
- `src/application/document-history-*`, `audit-policy.ts`: Workflow event projection.

## Adapters and Operator Surfaces

- `src/adapters/http/workflow-api.ts`, `resource-api.ts`: DocType-only administration and action-only transition routes.
- `src/adapters/desk/app.ts`, `render.ts`, `client.ts`: singular Workflow administration and actions.
- `src/cli/workflows.ts`, `resources.ts`, `command.ts`, `templates.ts`: old remote contracts and generated starter metadata.
- `examples/todos/models.ts`: singular starter Workflow and old Automation metadata.

## Persistence and Runtime Composition

- `src/core/workflow.ts` and `src/application/workflow-service.ts`: tenant-wide `__WorkflowDefinitions` fold.
- Cloudflare and in-memory application composition: effective DocType resolver assumes one Workflow.
- D1/in-memory projection query modules: query expression contracts must normalize through Predicate Kernel.

## Test Suites to Replace

- Core: workflow, automation-rules, list-view, schema, registry.
- Application: document command/service/field policy/history, workflow service/events/policy, Automation Run service/consumer.
- HTTP: workflow and resource APIs.
- Desk/client/render: Workflow administration, form actions, bulk actions.
- CLI: workflows, resources, doctypes, scaffold.
- Cloudflare: app routing and worker Automation drain.

## Search Gate

The final cutover must leave no production reference to:

- `DocTypeDefinition.workflow`;
- old Automation `events`, `changedFields`, or `condition` properties;
- action-index-based Automation identity;
- action-only transition routes;
- old Workflow event payloads without `workflow` and `stateField`;
- pre-cutover Workflow history readers, translators, replay paths, and projections;
- tenant-wide legacy Workflow Definition stream reads;
- `default` Workflow compatibility mapping.
