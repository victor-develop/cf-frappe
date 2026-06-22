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
  });
});
