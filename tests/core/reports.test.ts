import { createRegistry, defineDocType, defineReport, FrameworkError } from "../../src";

describe("reports", () => {
  it("registers reports after their DocType and lists them in stable order", () => {
    const Note = defineDocType({ name: "Note", fields: [{ name: "title", type: "text" }] });
    const registry = createRegistry({
      doctypes: [Note],
      reports: [
        defineReport({ name: "Zulu Notes", doctype: "Note", columns: [{ name: "title" }] }),
        defineReport({ name: "Alpha Notes", doctype: "Note", columns: [{ name: "title" }] })
      ]
    });

    expect(registry.listReports().map((report) => report.name)).toEqual(["Alpha Notes", "Zulu Notes"]);
  });

  it("rejects reports with duplicate columns", () => {
    expect(() =>
      defineReport({
        name: "Broken Notes",
        doctype: "Note",
        columns: [{ name: "title" }, { name: "title" }]
      })
    ).toThrow(FrameworkError);
  });

  it("rejects reports whose DocType is not registered", () => {
    const report = defineReport({ name: "Missing Notes", doctype: "Missing", columns: [{ name: "title" }] });

    expect(() => createRegistry({ reports: [report] })).toThrow("DocType 'Missing' is not registered");
  });

  it("validates report summary and group fields against the DocType", () => {
    const Note = defineDocType({
      name: "Note",
      fields: [
        { name: "title", type: "text" },
        { name: "count", type: "integer" },
        { name: "meta", type: "json" }
      ]
    });

    expect(() =>
      createRegistry({
        doctypes: [Note],
        reports: [
          defineReport({
            name: "Broken Summary",
            doctype: "Note",
            columns: [{ name: "title" }],
            summaries: [{ name: "missing_total", aggregate: "sum", field: "missing" }]
          })
        ]
      })
    ).toThrow("Report 'Broken Summary' summary 'missing_total' references unknown field 'missing'");

    expect(() =>
      createRegistry({
        doctypes: [Note],
        reports: [
          defineReport({
            name: "Broken Group",
            doctype: "Note",
            columns: [{ name: "title" }],
            groups: [{ name: "by_meta", field: "meta", summaries: [{ name: "rows", aggregate: "count" }] }]
          })
        ]
      })
    ).toThrow("Report 'Broken Group' group 'by_meta' cannot group by json field 'meta'");

    expect(() =>
      createRegistry({
        doctypes: [Note],
        reports: [
          {
            name: "Broken Aggregate",
            doctype: "Note",
            columns: [{ name: "title" }],
            summaries: [{ name: "median_count", aggregate: "median" as "sum", field: "count" }]
          }
        ]
      })
    ).toThrow("Report 'Broken Aggregate' summary 'median_count' has invalid aggregate 'median'");

    expect(() =>
      createRegistry({
        doctypes: [Note],
        reports: [
          {
            name: "Broken Group Aggregate",
            doctype: "Note",
            columns: [{ name: "title" }],
            groups: [
              {
                name: "by_title",
                field: "title",
                summaries: [{ name: "median_count", aggregate: "median" as "sum", field: "count" }]
              }
            ]
          }
        ]
      })
    ).toThrow("Report 'Broken Group Aggregate' summary 'median_count' on group 'by_title' has invalid aggregate 'median'");
  });

  it("validates report filters against supported operators, types, and fields", () => {
    const Note = defineDocType({
      name: "Note",
      fields: [
        { name: "title", type: "text" },
        { name: "count", type: "integer" },
        { name: "meta", type: "json" }
      ]
    });

    expect(() =>
      createRegistry({
        doctypes: [Note],
        reports: [
          {
            name: "Broken Filter Operator",
            doctype: "Note",
            columns: [{ name: "title" }],
            filters: [{ name: "title_filter", field: "title", operator: "between" as "eq" }]
          }
        ]
      })
    ).toThrow("Report 'Broken Filter Operator' filter 'title_filter' has invalid operator 'between'");

    expect(() =>
      createRegistry({
        doctypes: [Note],
        reports: [
          {
            name: "Broken Filter Type",
            doctype: "Note",
            columns: [{ name: "title" }],
            filters: [{ name: "count_filter", field: "count", type: "currency" as "integer" }]
          }
        ]
      })
    ).toThrow("Report 'Broken Filter Type' filter 'count_filter' has invalid type 'currency'");

    expect(() =>
      createRegistry({
        doctypes: [Note],
        reports: [
          defineReport({
            name: "Broken Json Filter",
            doctype: "Note",
            columns: [{ name: "title" }],
            filters: [{ name: "meta_filter", field: "meta" }]
          })
        ]
      })
    ).toThrow("Report 'Broken Json Filter' filter 'meta_filter' cannot filter by json field 'meta'");
  });

  it("validates report ordering against columns, directions, and sortable fields", () => {
    const Note = defineDocType({
      name: "Note",
      fields: [
        { name: "title", type: "text" },
        { name: "meta", type: "json" }
      ]
    });

    const ordered = defineReport({
      name: "Ordered Notes",
      doctype: "Note",
      columns: [{ name: "title", label: "Title" }],
      orderBy: "title",
      order: "desc"
    });

    expect(ordered).toMatchObject({ orderBy: "title", order: "desc" });

    expect(() =>
      defineReport({
        name: "Broken Order Column",
        doctype: "Note",
        columns: [{ name: "title" }],
        orderBy: "missing"
      })
    ).toThrow("Report 'Broken Order Column' orderBy references unknown column 'missing'");

    expect(() =>
      defineReport({
        name: "Broken Order Direction",
        doctype: "Note",
        columns: [{ name: "title" }],
        order: "sideways" as "asc"
      })
    ).toThrow("Report 'Broken Order Direction' has invalid order 'sideways'");

    expect(() =>
      createRegistry({
        doctypes: [Note],
        reports: [
          {
            name: "Raw Broken Order Direction",
            doctype: "Note",
            columns: [{ name: "title" }],
            order: "sideways" as "asc"
          }
        ]
      })
    ).toThrow("Report 'Raw Broken Order Direction' has invalid order 'sideways'");

    expect(() =>
      createRegistry({
        doctypes: [Note],
        reports: [
          defineReport({
            name: "Broken Json Order",
            doctype: "Note",
            columns: [{ name: "meta_value", field: "meta" }],
            orderBy: "meta_value"
          })
        ]
      })
    ).toThrow("Report 'Broken Json Order' cannot order by json column 'meta_value'");
  });

  it("validates report charts against grouped numeric summaries", () => {
    const Note = defineDocType({
      name: "Note",
      fields: [
        { name: "title", type: "text" },
        { name: "priority", type: "select", options: ["Low", "High"] }
      ]
    });

    expect(() =>
      defineReport({
        name: "Broken Chart",
        doctype: "Note",
        columns: [{ name: "title" }],
        charts: [{ name: "notes_chart", type: "bar", group: "missing", summary: "rows" }]
      })
    ).toThrow("Report 'Broken Chart' chart 'notes_chart' references unknown group 'missing'");

    expect(() =>
      defineReport({
        name: "Broken Type Chart",
        doctype: "Note",
        columns: [{ name: "title" }],
        groups: [
          {
            name: "by_priority",
            field: "priority",
            summaries: [{ name: "rows", aggregate: "count" }]
          }
        ],
        charts: [{ name: "priority_chart", type: "scatter" as "bar", group: "by_priority", summary: "rows" }]
      })
    ).toThrow("Report 'Broken Type Chart' chart 'priority_chart' has invalid type 'scatter'");

    expect(() =>
      defineReport({
        name: "Broken Min Chart",
        doctype: "Note",
        columns: [{ name: "title" }],
        groups: [
          {
            name: "by_priority",
            field: "priority",
            summaries: [{ name: "first_title", aggregate: "min", field: "title" }]
          }
        ],
        charts: [{ name: "priority_chart", type: "bar", group: "by_priority", summary: "first_title" }]
      })
    ).toThrow("Report 'Broken Min Chart' chart 'priority_chart' requires a numeric count, sum, or avg summary");

    const controlledChart = defineReport({
      name: "Controlled Chart",
      doctype: "Note",
      columns: [{ name: "title" }],
      groups: [
        {
          name: "by_priority",
          field: "priority",
          summaries: [{ name: "rows", aggregate: "count" }]
        }
      ],
      charts: [
        {
          name: "priority_chart",
          type: "bar",
          group: "by_priority",
          summary: "rows",
          orderBy: "value",
          order: "desc",
          colors: ["#1f6feb", "#2e7d32"],
          showValues: false
        }
      ]
    }).charts?.[0];

    expect(controlledChart).toMatchObject({
      orderBy: "value",
      order: "desc",
      colors: ["#1f6feb", "#2e7d32"],
      showValues: false
    });
    expect(Object.isFrozen(controlledChart?.colors)).toBe(true);

    expect(() =>
      defineReport({
        name: "Broken Sort Chart",
        doctype: "Note",
        columns: [{ name: "title" }],
        groups: [
          {
            name: "by_priority",
            field: "priority",
            summaries: [{ name: "rows", aggregate: "count" }]
          }
        ],
        charts: [
          {
            name: "priority_chart",
            type: "bar",
            group: "by_priority",
            summary: "rows",
            orderBy: "total" as "value"
          }
        ]
      })
    ).toThrow("Report 'Broken Sort Chart' chart 'priority_chart' has invalid orderBy 'total'");

    expect(() =>
      createRegistry({
        doctypes: [Note],
        reports: [
          {
            name: "Raw Broken Sort Chart",
            doctype: "Note",
            columns: [{ name: "title" }],
            groups: [
              {
                name: "by_priority",
                field: "priority",
                summaries: [{ name: "rows", aggregate: "count" }]
              }
            ],
            charts: [
              {
                name: "priority_chart",
                type: "bar",
                group: "by_priority",
                summary: "rows",
                orderBy: "total" as "value"
              }
            ]
          }
        ]
      })
    ).toThrow("Report 'Raw Broken Sort Chart' chart 'priority_chart' has invalid orderBy 'total'");

    expect(() =>
      defineReport({
        name: "Broken Direction Chart",
        doctype: "Note",
        columns: [{ name: "title" }],
        groups: [
          {
            name: "by_priority",
            field: "priority",
            summaries: [{ name: "rows", aggregate: "count" }]
          }
        ],
        charts: [
          {
            name: "priority_chart",
            type: "bar",
            group: "by_priority",
            summary: "rows",
            order: "sideways" as "asc"
          }
        ]
      })
    ).toThrow("Report 'Broken Direction Chart' chart 'priority_chart' has invalid order 'sideways'");

    expect(() =>
      defineReport({
        name: "Broken Color Chart",
        doctype: "Note",
        columns: [{ name: "title" }],
        groups: [
          {
            name: "by_priority",
            field: "priority",
            summaries: [{ name: "rows", aggregate: "count" }]
          }
        ],
        charts: [
          {
            name: "priority_chart",
            type: "bar",
            group: "by_priority",
            summary: "rows",
            colors: ["blue"]
          }
        ]
      })
    ).toThrow("Report 'Broken Color Chart' chart 'priority_chart' has invalid color 'blue'");
  });
});
