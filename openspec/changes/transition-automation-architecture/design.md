# Design

The authoritative design is [docs/transition-automation-architecture-blueprint.md](../../../docs/transition-automation-architecture-blueprint.md).

Implementation decisions:

- This is a clean break. Do not add `default` workflow mapping, old event/API adapters, historical Workflow event readers, or data translators.
- Every upgraded environment enters the new architecture through a separately approved reset and reseed; the runtime starts Workflow history from new-contract events only.
- Pure predicate and transition decisions belong in core/application policy modules.
- Services orchestrate I/O and atomic commit plans.
- Adapters parse, authorize entry, delegate, and render only.
- Workflow is a named DSL compiled into Transition Policy and available-action metadata.
- Automation selection occurs during atomic command planning; effects run asynchronously through durable Automation Runs.
- Roles remain explicit authorization metadata and are not hidden in arbitrary predicates.
- Direct controlled-field mutation requires an exact validated transition plan.
