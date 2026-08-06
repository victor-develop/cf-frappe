# Test Parity Target

The original goal requires cf-frappe to have no fewer test cases than the old framework. The current suite clears the static upstream marker count.

## Current Reference Count

Measured against `frappe/frappe` shallow clone at commit `309c656`:

```bash
git clone --depth 1 --filter=blob:none https://github.com/frappe/frappe.git /tmp/frappe-testcount
cd /tmp/frappe-testcount
git ls-files | rg '(^|/)(test_|tests/|.*\.test\.)' | wc -l
rg -n "^\s*def test_|^\s*class Test|^\s*it\(|^\s*test\(" --glob '!node_modules/**' --glob '!*.snap' | wc -l
```

Observed counts:

- Test-related files: `352`
- Static test/class markers: `2784`

## cf-frappe Current Count

As of the named Workflow and reliable Automation architecture upgrade:

- Vitest files: `256`
- Vitest cases: `3060`
- Remaining gap to Frappe static markers: `0` (`+276` over the reference marker count)

## Coverage Evidence

The architecture-critical gate configured in `vitest.config.ts` passes:

- Statements: `96.55%`
- Branches: `95.27%`
- Functions: `98.96%`
- Lines: `96.86%`

The naming-reliability gate in `vitest.naming-coverage.config.ts` enforces `93%` branch coverage per file:

- Overall naming-critical branches: `97.06%`
- `DocumentService`: `93.04%`
- `NamingService`: `97.14%`
- D1 document commit adapter: `100%`
- Durable Object command routing: `100%`
- Web Form input parsing: `100%`

The separate full-source report configured in `vitest.full-coverage.config.ts` is the honest repository baseline:

- Statements: `91.09%`
- Branches: `82.52%`
- Functions: `97.55%`
- Lines: `91.01%`

## Implication

The test-count criterion is satisfied by current evidence: `3060` passing Vitest cases against the Frappe static-marker reference of `2784`. Coverage evidence is reported separately: `npm run coverage` enforces the architecture-critical aggregate, `npm run coverage:naming` enforces 93 percent branches per naming-critical file, and `npm run coverage:all` reports the full-source baseline without presenting it as a scoped result. Future work should keep adding meaningful contract, runtime, model, API, Desk, D1, Durable Object, schema, auth, workflow, job, realtime, and file-storage tests as the framework grows, rather than adding noisy tests only to preserve a count.
