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

As of the atomic document command boundary slice:

- Vitest files: `235`
- Vitest cases: `2787`
- Remaining gap to Frappe static markers: `0` (`+3` over the reference marker count)

## Implication

The test-count criterion is satisfied by current evidence: `2787` passing Vitest cases against the Frappe static-marker reference of `2784`. Future work should keep adding meaningful contract, runtime, model, API, Desk, D1, Durable Object, migration, auth, workflow, job, realtime, and file-storage tests as the framework grows, rather than adding noisy tests only to preserve a count.
