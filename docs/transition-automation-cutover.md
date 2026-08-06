# Named Workflow Cutover Runbook

This runbook defines the operator boundary for the clean transition to named multi-workflow metadata, events, APIs, and Automation contracts.

The framework does not migrate, translate, replay, or project pre-cutover Workflow definitions or Workflow events. Do not run a reset from this document alone. A named operator must approve the exact environment, backup checkpoint, reset scope, and maintenance window first.

## Recommended Strategy

Use replacement infrastructure instead of deleting rows in place:

1. Freeze writes and pause Queue consumers for the target environment.
2. Record a provider-supported D1 restore point or full export and verify that it can be restored.
3. Record the current Worker deployment, D1 binding, Durable Object namespace bindings, Queue bindings, R2 bindings, and deployed application version.
4. Provision a new empty D1 database and new Durable Object namespaces for the upgraded runtime.
5. Keep existing R2 objects unless the application explicitly stores Workflow-derived artifacts there.
6. Apply the new schema migrations to the empty replacement database, deploy the clean-contract runtime, and reseed through registered data patches.
7. Keep the old resources read-only until post-cutover verification and the rollback window are complete.

This replacement-resource strategy is the supported path. A selective in-place purge requires an application-specific, reviewed operator procedure and separate destructive-operation approval; cf-frappe intentionally ships no selective purge or old-event migration utility.

## Reset Scope

The approved reset must cover every persisted component whose meaning depends on the removed contracts:

- pre-cutover Workflow definition streams and projections;
- document events using the removed Workflow event payloads;
- document projections whose controlled state fields were produced by those events;
- Automation Runs causally created from pre-cutover Workflow events;
- cached metadata and Durable Object state derived from the old definitions;
- generated starter data or fixtures that submit singular Workflow metadata or unqualified transition commands.

Unrelated R2 file content, external identity-provider state, and unrelated application data are outside the default scope. If a full fresh D1 database is used, the approved backup is the source of truth for any application data that must later be reintroduced through new-contract seeds or import jobs.

## Approval Record

Before any reset, record:

- environment and account identifier;
- current deployment version and commit;
- backup or restore-point identifier;
- old and replacement binding identifiers;
- exact reset scope;
- maintenance-window owner;
- validation owner;
- rollback deadline;
- explicit human approval for the reset.

Do not place credentials, tokens, passwords, or private keys in the record. Reference the approved secret manager instead.

## Pre-Cutover Verification

Confirm all of the following before switching traffic:

- application metadata uses `workflows[]` with stable `name` and `stateField` values;
- transition routes and clients require a workflow name;
- registered Automation rules use stable rule and action IDs plus the new trigger contract;
- generated starters and public examples contain no singular Workflow metadata;
- `npm run check` passes at the release commit;
- Queue consumers are paused or drained;
- the backup restore procedure has been tested or otherwise verified by the operator.

## Provision And Deploy

Run the generated application's normal reviewed deployment commands against the replacement resources:

```bash
npm ci
npm run cf:types
npm run d1:generate
npm run d1:migrate:remote
npm run deploy
```

Inject deployment credentials through environment variables or the approved secret manager. Never place them in source files or command arguments.

## Reseed

Use registered, idempotent data patches. Plan each patch before applying it:

```bash
npx cf-frappe data-patches status --url https://your-worker.example --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe data-patches plan --url https://your-worker.example --id <registered-seed-id> --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe data-patches apply --url https://your-worker.example --id <registered-seed-id> --header-env Authorization=CF_FRAPPE_AUTH
```

Applications with several seeds should apply them in their reviewed dependency order. Seeds must emit only new-contract events and must use workflow-qualified transitions.

## Post-Cutover Verification

Verify at least one configured DocType end to end:

```bash
npx cf-frappe workflows list --url https://your-worker.example --doctype Task --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe workflows get --url https://your-worker.example --doctype Task --workflow lifecycle --header-env Authorization=CF_FRAPPE_AUTH
npx cf-frappe resources transition --url https://your-worker.example --doctype Task --name <document-name> --workflow lifecycle --transition <action> --expected-version <version> --header-env Authorization=CF_FRAPPE_AUTH
```

Also confirm:

- Desk groups actions by workflow and keeps every owned state field read-only;
- a denied role, false transition predicate, and stale version commit no event or Automation Run;
- a successful transition records workflow name, state field, action, from, and to;
- Automation retries and dead-letter operations are visible to authorized operators;
- old Workflow routes and payloads return an error rather than being translated.

## Rollback

Rollback means routing the previous application deployment back to its original read-only resources within the approved rollback window. Do not point the old runtime at new-contract state, and do not point the new runtime at pre-cutover Workflow history.

If new writes have occurred after cutover, preserve the replacement resources for incident analysis. Reconciliation into a later clean deployment is an application-specific operation, not a framework compatibility path.

## Local Development

For local persisted Wrangler state, archive the existing `.wrangler/state` directory under an operator-chosen backup name, start with a new empty persistence directory, then run:

```bash
npm run setup:local
npm run dev
```

Do not overwrite or remove the archived local state until verification is complete.
