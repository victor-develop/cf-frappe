# Test Parity Target

The original goal requires cf-frappe to have no fewer test cases than the old framework. This is not satisfied yet.

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

As of the document collaboration event helper slice:

- Vitest files: `187`
- Vitest cases: `2123`
- Remaining gap to Frappe static markers: `661`

## Implication

The framework can pass its local quality gate and still fail the full goal. The remaining work is not to generate noisy tests, but to build real parity surfaces and cover them with meaningful contract, runtime, model, API, Desk, D1, Durable Object, migration, auth, workflow, job, realtime, and file-storage tests until the count and quality both clear the Frappe reference.
