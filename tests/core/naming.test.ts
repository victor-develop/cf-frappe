import {
  applyNamingConfigurationToDocType,
  assertNamingStrategyDefinition,
  compileNamingPattern,
  defineDocType,
  foldNamingConfiguration,
  namingSeriesCurrentValue,
  namingTargetData,
  nextNamingCandidates,
  normalizeNamingStrategy,
  renderNamingCandidate,
  resolveNamingSeriesIdentity,
  type DomainEvent,
  type NamingSeriesStrategy
} from "../../src";

const Invoice = defineDocType({
  name: "Invoice",
  fields: [
    { name: "invoice_number", type: "text", required: true, readOnly: true, noCopy: true },
    { name: "region", type: "text" },
    { name: "priority", type: "integer" },
    { name: "details", type: "longText" }
  ]
});

const context = { tenantId: "acme", now: "2026-08-06T12:30:00.000Z" };

describe("naming engine", () => {
  it("compiles legacy and explicit sequence patterns", () => {
    expect(compileNamingPattern(Invoice, series("INV-####")).tokens).toEqual([
      { kind: "literal", value: "INV-" },
      { kind: "sequence", width: 4 }
    ]);
    expect(compileNamingPattern(Invoice, series("{doctype}-{sequence:6}")).tokens).toEqual([
      { kind: "doctype" },
      { kind: "literal", value: "-" },
      { kind: "sequence", width: 6 }
    ]);
  });

  it("renders date, tenant, doctype, field, padding, and sequence tokens", () => {
    const strategy = series("{tenant}-{doctype}-{field:region}-{YYYY}{YY}{MM}{DD}{DDD}{WW}-{sequence}", {
      padding: 5
    });
    expect(renderNamingCandidate(Invoice, strategy, { region: "HK" }, context, 42)).toBe(
      "acme-Invoice-HK-202626080621832-00042"
    );
  });

  it("derives stable named counter scopes and reset buckets", () => {
    const identity = resolveNamingSeriesIdentity(
      Invoice,
      series("INV-{YYYY}-{MM}-{field:region}-{field:priority}-{sequence:4}", {
        counter: "invoices",
        reset: "month",
        scopeFields: ["region", "priority"]
      }),
      { region: "Hong Kong", priority: 2 },
      context
    );
    expect(identity).toEqual({
      counter: "invoices",
      scope: "date=2026-08|region=Hong%20Kong|priority=2",
      documentName: "Invoice:invoices:date=2026-08|region=Hong%20Kong|priority=2"
    });

    expect(resolveNamingSeriesIdentity(Invoice, series("Y-{YYYY}-{sequence}", { reset: "year" }), {}, context).scope)
      .toBe("date=2026");
    expect(resolveNamingSeriesIdentity(Invoice, series("D-{YYYY}-{DDD}-{sequence}", { reset: "day" }), {}, context).scope)
      .toBe("date=2026-08-06");
    expect(resolveNamingSeriesIdentity(Invoice, series("INV-{sequence}"), {}, context)).toMatchObject({
      counter: "INV-{sequence}",
      scope: "",
      documentName: "Invoice:INV-{sequence}"
    });
  });

  it("skips structured and safe-regex exclusions with bounded attempts", () => {
    const candidates = nextNamingCandidates({
      doctype: Invoice,
      strategy: series("INV-{sequence:3}", {
        start: 1,
        exclusions: [
          { type: "range", from: 1, to: 2 },
          { type: "exact", value: "INV-003" },
          { type: "prefix", value: "NEVER" },
          { type: "suffix", value: "004" },
          { type: "contains", value: "-005" },
          { type: "regex", pattern: "007$" }
        ]
      }),
      data: {},
      context,
      count: 3
    });
    expect(candidates).toEqual([
      { value: 6, name: "INV-006" },
      { value: 8, name: "INV-008" },
      { value: 9, name: "INV-009" }
    ]);
  });

  it("supports case-insensitive safe regex and configurable steps", () => {
    expect(nextNamingCandidates({
      doctype: Invoice,
      strategy: series("inv-{sequence:2}", {
        step: 2,
        exclusions: [{ type: "regex", pattern: "^INV-03$", flags: "i" }]
      }),
      data: {},
      context,
      current: 1,
      count: 2
    })).toEqual([
      { value: 5, name: "inv-05" },
      { value: 7, name: "inv-07" }
    ]);
  });

  it("writes generated identifiers into the configured target field", () => {
    const strategy = series("INV-{sequence:4}", { targetField: "invoice_number" });
    expect(namingTargetData(strategy, { region: "HK" }, "INV-0001")).toEqual({
      region: "HK",
      invoice_number: "INV-0001"
    });
    expect(namingSeriesCurrentValue(0)).toBe(0);
    expect(namingSeriesCurrentValue(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(namingSeriesCurrentValue(-1)).toBeUndefined();
    expect(namingSeriesCurrentValue(1.5)).toBeUndefined();
    expect(namingSeriesCurrentValue("1")).toBeUndefined();
    expect(namingTargetData(series("INV-{sequence}"), { region: "HK" }, "INV-1")).toEqual({ region: "HK" });
  });

  it("normalizes immutable strategy metadata", () => {
    const strategy = normalizeNamingStrategy(Invoice, series("INV-{field:region}-{sequence}", {
      targetField: "invoice_number",
      counter: "invoice.main",
      scopeFields: ["region"],
      exclusions: [{ type: "range", from: 10, to: 12 }]
    }));
    expect(strategy).toMatchObject({
      kind: "series",
      targetField: "invoice_number",
      counter: "invoice.main",
      scopeFields: ["region"]
    });
    expect(Object.isFrozen(strategy)).toBe(true);
  });

  it.each([
    ["missing sequence", () => series("INV")],
    ["multiple sequences", () => series("INV-##-{sequence}")],
    ["unknown token", () => series("INV-{unknown}-{sequence}")],
    ["missing field token", () => series("INV-{field:missing}-{sequence}")],
    ["unsafe regex groups", () => series("INV-{sequence}", { exclusions: [{ type: "regex", pattern: "(a+)+" }] })],
    ["invalid range", () => series("INV-{sequence}", { exclusions: [{ type: "range", from: 5, to: 4 }] })],
    ["invalid target", () => series("INV-{sequence}", { targetField: "missing" })],
    ["invalid target type", () => series("INV-{sequence}", { targetField: "priority" })],
    ["mutable target", () => normalizeNamingStrategy({
      ...Invoice,
      fields: Invoice.fields.map((field) => field.name === "invoice_number" ? { ...field, readOnly: false } : field)
    }, series("INV-{sequence}", { targetField: "invoice_number" }))],
    ["copyable target", () => normalizeNamingStrategy({
      ...Invoice,
      fields: Invoice.fields.map((field) => field.name === "invoice_number" ? { ...field, noCopy: false } : field)
    }, series("INV-{sequence}", { targetField: "invoice_number" }))],
    ["invalid scope", () => series("INV-{sequence}", { scopeFields: ["details"] })],
    ["missing scope", () => series("INV-{sequence}", { scopeFields: ["missing"] })],
    ["duplicate scope", () => series("INV-{sequence}", { scopeFields: ["region", "region"] })],
    ["hidden scope", () => series("INV-{sequence}", { scopeFields: ["region"] })],
    ["hidden year reset", () => series("INV-{sequence}", { reset: "year" })],
    ["hidden month reset", () => series("INV-{YYYY}-{sequence}", { reset: "month" })],
    ["hidden day reset", () => series("INV-{YYYY}-{MM}-{sequence}", { reset: "day" })],
    ["invalid counter", () => series("INV-{sequence}", { counter: "bad counter" })],
    ["invalid padding", () => series("INV-{sequence}", { padding: 0 })],
    ["invalid reset", () => series("INV-{sequence}", { reset: "week" as never })],
    ["invalid regex flags", () => series("INV-{sequence}", {
      exclusions: [{ type: "regex", pattern: "INV", flags: "g" as never }]
    })],
    ["invalid regex syntax", () => series("INV-{sequence}", { exclusions: [{ type: "regex", pattern: "[" }] })],
    ["too many exclusions", () => series("INV-{sequence}", {
      exclusions: Array.from({ length: 101 }, () => ({ type: "exact" as const, value: "unused" }))
    })],
    ["empty pattern", () => series("")],
    ["unsafe pattern", () => series("INV-\n-{sequence}")],
    ["long pattern", () => series(`${"A".repeat(257)}{sequence}`)]
  ])("rejects %s", (_label, build) => {
    expect(() => normalizeNamingStrategy(Invoice, build())).toThrow();
  });

  it.each([
    ["oversized legacy sequence", () => compileNamingPattern(Invoice, series("###################"))],
    ["unclosed token", () => compileNamingPattern(Invoice, series("INV-{sequence"))],
    ["unmatched brace", () => compileNamingPattern(Invoice, series("INV-}{sequence}"))],
    ["too many tokens", () => compileNamingPattern(Invoice, series(`${"{YYYY}".repeat(32)}{sequence}`))],
    ["negative sequence", () => renderNamingCandidate(Invoice, series("INV-{sequence}"), {}, context, -1)],
    ["unsafe field value", () => renderNamingCandidate(
      Invoice,
      series("{field:region}-{sequence}"),
      { region: "\n" },
      context,
      1
    )],
    ["non-scalar field value", () => renderNamingCandidate(
      Invoice,
      series("{field:region}-{sequence}"),
      { region: { nested: true } },
      context,
      1
    )],
    ["invalid clock", () => renderNamingCandidate(Invoice, series("{YYYY}-{sequence}"), {}, {
      ...context,
      now: "not-a-date"
    }, 1)],
    ["oversized result", () => renderNamingCandidate(
      Invoice,
      series(`${"A".repeat(240)}{sequence:18}`),
      {},
      context,
      1
    )],
    ["invalid preview count", () => nextNamingCandidates({
      doctype: Invoice,
      strategy: series("INV-{sequence}"),
      data: {},
      context,
      count: 0
    })],
    ["safe integer exhaustion", () => nextNamingCandidates({
      doctype: Invoice,
      strategy: series("INV-{sequence}"),
      data: {},
      context,
      current: Number.MAX_SAFE_INTEGER
    })]
  ])("fails closed for %s", (_label, run) => {
    expect(run).toThrow();
  });

  it("validates non-series and declared series strategies through the DocType boundary", () => {
    expect(normalizeNamingStrategy(Invoice, { kind: "uuid" })).toEqual({ kind: "uuid" });
    expect(() => assertNamingStrategyDefinition({
      ...Invoice,
      naming: series("INV-{sequence:4}", { targetField: "invoice_number" })
    })).not.toThrow();
  });

  it("folds tenant naming overrides and rejects applying them to another DocType", () => {
    const saved = namingConfigurationEvent(2, {
      kind: "NamingStrategySaved",
      doctypeName: "Invoice",
      strategy: { kind: "uuid" }
    });
    const ignored = namingConfigurationEvent(1, {
      kind: "NamingStrategySaved",
      doctypeName: "Other",
      strategy: { kind: "provided" }
    });
    const state = foldNamingConfiguration("acme", Invoice, [saved, ignored]);
    expect(state).toMatchObject({ version: 2, source: "runtime", effectiveStrategy: { kind: "uuid" } });
    expect(applyNamingConfigurationToDocType(Invoice, state)).toMatchObject({ naming: { kind: "uuid" } });
    expect(() => applyNamingConfigurationToDocType({ ...Invoice, name: "Other" }, state)).toThrow("cannot be applied");
  });

  it("fails closed when exclusions exhaust the configured search", () => {
    expect(() => nextNamingCandidates({
      doctype: Invoice,
      strategy: series("INV-{sequence}", {
        maxAttempts: 2,
        exclusions: [{ type: "range", from: 1, to: 10 }]
      }),
      data: {},
      context
    })).toThrow("attempt limit");
  });
});

function series(
  pattern: string,
  overrides: Omit<Partial<NamingSeriesStrategy>, "kind" | "pattern"> = {}
): NamingSeriesStrategy {
  return { kind: "series", pattern, ...overrides };
}

function namingConfigurationEvent(
  sequence: number,
  payload: DomainEvent["payload"]
): DomainEvent {
  return {
    id: `evt-${String(sequence)}`,
    tenantId: "acme",
    stream: "naming:acme:Invoice",
    sequence,
    type: typeof payload === "object" && payload !== null && "kind" in payload ? String(payload.kind) : "Unknown",
    doctype: "__NamingConfiguration",
    documentName: "Invoice",
    actorId: "admin",
    occurredAt: `2026-08-06T00:00:0${String(sequence)}.000Z`,
    payload,
    metadata: {}
  };
}
