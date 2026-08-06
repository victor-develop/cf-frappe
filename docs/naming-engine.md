# Naming Engine

## Purpose

cf-frappe uses the document `name` as its framework identity. The Naming Engine can generate that name and optionally mirror the same value into a read-only business field for numbers such as `RMA-2026-000001`, `INV-HK-2026-0042`, or tenant-specific ticket numbers.

Applications that require a separate immutable technical UUID must model it explicitly as another generated or application-owned field. The Naming Engine does not claim to add a hidden universal technical identifier.

The engine is a framework primitive. It is not implemented in application hooks and it does not allocate a number before document creation.

## Definition

```ts
const ReturnRequest = defineDocType({
  name: "Return Request",
  naming: {
    kind: "series",
    pattern: "RMA-{YYYY}-{sequence:6}",
    targetField: "return_id",
    counter: "returns",
    reset: "year",
    start: 1,
    step: 1,
    exclusions: [{ type: "range", from: 666, to: 666 }],
    maxAttempts: 10_000
  },
  fields: [
    { name: "return_id", type: "text", required: true, readOnly: true, noCopy: true }
  ]
});
```

Supported pattern tokens:

| Token | Meaning |
| --- | --- |
| `####` | Legacy numeric sequence with width four |
| `{sequence}` | Numeric sequence using `padding` |
| `{sequence:6}` | Numeric sequence with an explicit width |
| `{YYYY}`, `{YY}` | UTC year |
| `{MM}`, `{DD}` | UTC month and day |
| `{DDD}`, `{WW}` | UTC day-of-year and ISO week |
| `{tenant}`, `{doctype}` | Tenant and DocType names |
| `{field:region}` | A validated scalar document field |

Prefix and suffix text are ordinary pattern literals. A pattern must contain exactly one sequence token.

## Counter Identity

`counter` is stable independently of `pattern`. Changing `RMA-{sequence:6}` to `RETURN-{sequence:6}` affects only future names and continues the same counter.

Counters are tenant- and DocType-scoped. Optional `scopeFields` create independent counters for values such as region or business unit. `reset` adds a UTC year, month, or day bucket to the scope.

Counter partitions must be visible in the generated identifier so two partitions cannot render the same name:

- every `scopeFields` entry must also appear as `{field:<name>}` in `pattern`;
- yearly reset requires `{YYYY}`;
- monthly reset requires `{YYYY}` and `{MM}`;
- daily reset requires `{YYYY}` plus either `{DDD}` or both `{MM}` and `{DD}`.

The optional generated target must be a `text` field with both `readOnly: true` and `noCopy: true`. It is immutable across create, update, unset, merge, workflow, domain-command, duplicate, and amend paths.

## Exclusions

The engine supports exact, prefix, suffix, substring, numeric range, and safe regular-expression exclusions. Safe regex supports anchors, literals, `.`, character classes, common character shorthands, and bounded or unbounded atom quantifiers. It is parsed and matched by cf-frappe with dynamic programming; user patterns are never executed by JavaScript's backtracking regular-expression engine. Matching is bounded by pattern length times generated-ID length.

Candidate search is bounded by `maxAttempts` and fails closed when no permitted value can be found.

## Atomicity

For every series-named create, cf-frappe commits these writes in one `DocumentStore.commitBatch` operation:

1. Naming counter start or advance event.
2. Generated target-field value.
3. Unique-value reservations.
4. Document creation event and projection.
5. Durable Automation run plans created by the document event.

If any part fails, no number is consumed. Existing legacy names are skipped before commit, and the accepted candidate advances the counter atomically. All create-like operations are serialized through one stable tenant-and-DocType Durable Object coordinator, including when runtime metadata changes a static naming strategy. Final document-name and metadata-defined unique constraints remain independent invariants.

Runtime naming is revalidated whenever metadata layers are composed. Custom-field saves and disables are rejected before commit when they would invalidate a target field, scope field, or field token used by the active naming strategy.

## Administration

`/desk/admin/naming` provides metadata-driven controls for pattern, target field, named counter, padding, start, step, reset, scope fields, exclusions, and retry limits.

The HTTP API exposes:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/naming/:doctype` | Read static/runtime/effective configuration |
| `PUT` | `/api/naming/:doctype` | Save a tenant runtime strategy |
| `DELETE` | `/api/naming/:doctype` | Clear the runtime strategy |
| `POST` | `/api/naming/:doctype/preview` | Preview 1-100 IDs without consuming them |
| `POST` | `/api/naming/:doctype/counter` | Move one concrete scoped counter forward |

Configuration and counter writes use optimistic versions. Counter administration cannot move a counter backward. The target-field selector only offers immutable `text + readOnly + noCopy` fields.

## Verification Gate

`npm run coverage:naming` enforces at least 93 percent branch coverage per naming-critical file, rather than as an aggregate average. The gate includes core parsing/rendering, runtime configuration, NamingService, DocumentService allocation and retry, D1 atomic commit, Durable Object routing, naming HTTP APIs, and JSON/HTML Web Form input boundaries.

## Bulk Creation

CSV import and other bulk create paths delegate each row to `DocumentCommandExecutor.create`. Every generated identifier therefore retains the same validation, authorization, exclusion, retry, and atomic-commit guarantees as an interactive create.

## 中文说明

Naming Engine 是 cf-frappe 的框架级业务编号能力，不需要应用在 hook 里手工拼接 ID。它支持前后缀、数字位数、起始值、步长、日期 token、文档字段 token、named counter、按字段分 scope、按年/月/日重置、安全排除规则、预览、批量创建和计数器只向前调整。每个 scope/reset 维度必须同时出现在最终 pattern 中，避免不同分区生成相同 ID。

业务编号、计数器事件、生成字段、唯一值占用、文档创建事件和 Automation 计划在同一个原子 batch 中提交。因此文档创建失败不会消耗编号，旧数据已经占用的候选值会被安全跳过。所有 create-like 操作都通过稳定的 tenant + DocType Durable Object coordinator 串行化，运行时切换 naming strategy 也不会改变协调边界。

生成字段必须是 `text + readOnly + noCopy`，并且在 update、unset、merge、workflow、domain command、duplicate 和 amend 路径上都不可修改。安全 regex 由框架自己的线性动态规划 matcher 执行，不会把管理员输入交给 JavaScript 回溯正则引擎。运行时配置可以在 `/desk/admin/naming` 管理；custom field 变更如果会破坏当前 naming 依赖，会在提交前被拒绝。
