import { createRegistry, defineDashboard, defineDocType, defineReport, FrameworkError } from "../../src";

describe("dashboards", () => {
  it("freezes metadata-defined dashboard cards", () => {
    const dashboard = defineDashboard({
      name: "Operations",
      roles: ["User"],
      cards: [
        {
          name: "open_notes",
          label: "Open Notes",
          source: {
            kind: "documentCount",
            doctype: "Note",
            filters: [{ field: "workflow_state", value: "Open" }]
          }
        },
        {
          name: "total_open_count",
          source: {
            kind: "documentAggregate",
            doctype: "Note",
            aggregate: "sum",
            field: "count",
            filters: [{ field: "workflow_state", value: "Open" }]
          }
        },
        {
          name: "total_count",
          source: {
            kind: "reportSummary",
            report: "Open Notes",
            summary: "total_count",
            filters: { priority: "High" }
          }
        },
        {
          name: "priority_chart",
          source: {
            kind: "reportChart",
            report: "Open Notes",
            chart: "notes_by_priority",
            filters: { priority: "High" }
          }
        }
      ]
    });

    expect(Object.isFrozen(dashboard)).toBe(true);
    expect(Object.isFrozen(dashboard.cards)).toBe(true);
    expect(Object.isFrozen(dashboard.cards[0]?.source)).toBe(true);
    expect(Object.isFrozen(dashboard.cards[0]?.source.kind === "documentCount" ? dashboard.cards[0].source.filters : [])).toBe(true);
    expect(Object.isFrozen(dashboard.cards[1]?.source.kind === "documentAggregate" ? dashboard.cards[1].source.filters : [])).toBe(true);
    expect(Object.isFrozen(dashboard.cards[2]?.source.kind === "reportSummary" ? dashboard.cards[2].source.filters : {})).toBe(true);
    expect(Object.isFrozen(dashboard.cards[3]?.source.kind === "reportChart" ? dashboard.cards[3].source.filters : {})).toBe(true);
  });

  it("validates dashboard card sources against registered DocTypes and reports", () => {
    const Note = defineDocType({
      name: "Note",
      fields: [
        { name: "title", type: "text" },
        { name: "workflow_state", type: "select", options: ["Open", "Closed"] },
        { name: "count", type: "integer" }
      ]
    });
    const report = defineReport({
      name: "Open Notes",
      doctype: "Note",
      columns: [{ name: "title" }],
      summaries: [{ name: "total_count", aggregate: "sum", field: "count" }],
      groups: [
        {
          name: "by_state",
          field: "workflow_state",
          summaries: [{ name: "state_count", aggregate: "count" }]
        }
      ],
      charts: [{ name: "notes_by_state", type: "bar", group: "by_state", summary: "state_count" }]
    });

    const registry = createRegistry({
      doctypes: [Note],
      reports: [report],
      dashboards: [
        defineDashboard({
          name: "Operations",
          cards: [
            {
              name: "open_notes",
              source: {
                kind: "documentCount",
                doctype: "Note",
                filters: [{ field: "workflow_state", value: "Open" }]
              }
            },
            {
              name: "total_open_count",
              source: {
                kind: "documentAggregate",
                doctype: "Note",
                aggregate: "sum",
                field: "count",
                filters: [{ field: "workflow_state", value: "Open" }]
              }
            },
            {
              name: "total_count",
              source: { kind: "reportSummary", report: "Open Notes", summary: "total_count" }
            },
            {
              name: "notes_by_state",
              source: { kind: "reportChart", report: "Open Notes", chart: "notes_by_state" }
            }
          ]
        })
      ]
    });

    expect(registry.getDashboard("Operations")).toMatchObject({
      cards: [
        { name: "open_notes", source: { kind: "documentCount", doctype: "Note" } },
        { name: "total_open_count", source: { kind: "documentAggregate", doctype: "Note", aggregate: "sum", field: "count" } },
        { name: "total_count", source: { kind: "reportSummary", report: "Open Notes" } },
        { name: "notes_by_state", source: { kind: "reportChart", report: "Open Notes", chart: "notes_by_state" } }
      ]
    });
    expect(() =>
      createRegistry({
        doctypes: [Note],
        dashboards: [
          defineDashboard({
            name: "Broken",
            cards: [{ name: "missing", source: { kind: "documentCount", doctype: "Missing" } }]
          })
        ]
      })
    ).toThrow(FrameworkError);
    expect(() =>
      createRegistry({
        doctypes: [Note],
        dashboards: [
          defineDashboard({
            name: "Broken",
            cards: [
              {
                name: "missing",
                source: { kind: "documentAggregate", doctype: "Note", aggregate: "sum", field: "missing" }
              }
            ]
          })
        ]
      })
    ).toThrow("references unknown aggregate field");
    expect(() =>
      createRegistry({
        doctypes: [Note],
        dashboards: [
          defineDashboard({
            name: "Broken",
            cards: [
              {
                name: "text_sum",
                source: { kind: "documentAggregate", doctype: "Note", aggregate: "sum", field: "title" }
              }
            ]
          })
        ]
      })
    ).toThrow("must be an integer or number field");
    expect(() =>
      defineDashboard({
        name: "Broken",
        cards: [{ name: "count", source: { kind: "documentAggregate", doctype: "Note", aggregate: "count", field: "count" } }]
      })
    ).toThrow("count aggregate must not define a field");
    expect(() =>
      createRegistry({
        doctypes: [Note],
        reports: [report],
        dashboards: [
          defineDashboard({
            name: "Broken",
            cards: [{ name: "missing", source: { kind: "reportSummary", report: "Open Notes", summary: "missing" } }]
          })
        ]
      })
    ).toThrow("references unknown summary");
    expect(() =>
      createRegistry({
        doctypes: [Note],
        reports: [report],
        dashboards: [
          defineDashboard({
            name: "Broken",
            cards: [{ name: "missing", source: { kind: "reportChart", report: "Open Notes", chart: "missing" } }]
          })
        ]
      })
    ).toThrow("references unknown chart");
  });

  it("validates dashboard report-summary filter presets at registration", () => {
    const Note = defineDocType({
      name: "Note",
      fields: [
        { name: "title", type: "text" },
        { name: "priority", type: "select", options: ["Low", "High"] },
        { name: "count", type: "integer" }
      ]
    });
    const filteredReport = defineReport({
      name: "Filtered Notes",
      doctype: "Note",
      columns: [{ name: "title" }],
      summaries: [{ name: "note_count", aggregate: "count" }],
      filters: [
        { name: "priority", field: "priority", type: "select" },
        { name: "count", field: "count", type: "integer" }
      ]
    });
    const requiredReport = defineReport({
      name: "Required Notes",
      doctype: "Note",
      columns: [{ name: "title" }],
      summaries: [{ name: "note_count", aggregate: "count" }],
      filters: [{ name: "priority", field: "priority", type: "select", required: true }]
    });

    expect(() =>
      createRegistry({
        doctypes: [Note],
        reports: [filteredReport],
        dashboards: [
          defineDashboard({
            name: "Typo",
            cards: [
              {
                name: "notes",
                source: { kind: "reportSummary", report: "Filtered Notes", summary: "note_count", filters: { priorty: "High" } }
              }
            ]
          })
        ]
      })
    ).toThrow("unknown filter 'priorty'");
    expect(() =>
      createRegistry({
        doctypes: [Note],
        reports: [filteredReport],
        dashboards: [
          defineDashboard({
            name: "Bad Count",
            cards: [
              {
                name: "notes",
                source: { kind: "reportSummary", report: "Filtered Notes", summary: "note_count", filters: { count: "many" } }
              }
            ]
          })
        ]
      })
    ).toThrow("must be an integer");
    expect(() =>
      createRegistry({
        doctypes: [Note],
        reports: [
          defineReport({
            ...filteredReport,
            groups: [{ name: "by_priority", field: "priority", summaries: [{ name: "rows", aggregate: "count" }] }],
            charts: [{ name: "priority_rows", type: "bar", group: "by_priority", summary: "rows" }]
          })
        ],
        dashboards: [
          defineDashboard({
            name: "Bad Chart Filter",
            cards: [
              {
                name: "notes",
                source: { kind: "reportChart", report: "Filtered Notes", chart: "priority_rows", filters: { count: "many" } }
              }
            ]
          })
        ]
      })
    ).toThrow("must be an integer");
    expect(() =>
      createRegistry({
        doctypes: [Note],
        reports: [requiredReport],
        dashboards: [
          defineDashboard({
            name: "Missing Required",
            cards: [
              {
                name: "notes",
                source: { kind: "reportSummary", report: "Required Notes", summary: "note_count" }
              }
            ]
          })
        ]
      })
    ).toThrow("missing required filter 'priority'");
  });
});
