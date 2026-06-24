import {
  REPORT_FILTER_EXPRESSION_MAX_NODES,
  REPORT_FORMULA_MAX_DEPTH,
  savedReportsStream,
  type JsonObject
} from "../../src";
import { createServices, data, manager, now, owner } from "../helpers";

describe("SavedReportService", () => {
  it("saves normalized user report definitions as events and lists only the actor's reports", async () => {
    const { events, savedReports } = createServices(["create-1"], {
      savedReportIds: ["high", "event-1", "manager", "event-2"]
    });

    const saved = await savedReports.save({
      actor: owner,
      doctype: "Note",
      label: "  High note report  ",
      definition: {
        columns: [
          { name: "title", label: "Title" },
          { name: "priority", label: "Priority" }
        ],
        filters: [{ name: "priority", field: "priority", type: "select", defaultValue: "High" }],
        filterExpression: {
          kind: "group",
          match: "all",
          filters: [{ filter: "priority", value: "High" }]
        },
        orderBy: "title",
        order: "asc"
      }
    });
    await savedReports.save({
      actor: manager,
      doctype: "Note",
      label: "Manager report",
      definition: { columns: [{ name: "title" }] }
    });

    expect(saved).toMatchObject({
      id: "report_high",
      doctype: "Note",
      ownerId: owner.id,
      label: "High note report",
      definition: {
        columns: [{ name: "title", label: "Title" }, { name: "priority", label: "Priority" }],
        filters: [{ name: "priority", field: "priority", type: "select", defaultValue: "High" }],
        filterExpression: {
          kind: "group",
          match: "all",
          filters: [{ filter: "priority", value: "High" }]
        },
        orderBy: "title",
        order: "asc"
      }
    });
    await expect(savedReports.list(owner, "Note")).resolves.toMatchObject([
      { id: "report_high", label: "High note report" }
    ]);
    await expect(events.readStream("acme:__SavedReports:Note%3Aowner%40example%2Ecom")).resolves.toMatchObject([
      {
        type: "NoteSavedReportSaved",
        documentName: "report_high",
        payload: {
          kind: "SavedReportSaved",
          reportId: "report_high",
          ownerId: owner.id,
          label: "High note report",
          definition: {
            columns: [{ name: "title", label: "Title" }, { name: "priority", label: "Priority" }],
            filters: [{ name: "priority", field: "priority", type: "select", defaultValue: "High" }],
            filterExpression: {
              kind: "group",
              match: "all",
              filters: [{ filter: "priority", value: "High" }]
            }
          }
        }
      }
    ]);
    await expect(savedReports.list(manager, "Note")).resolves.toMatchObject([
      { id: "report_manager", label: "Manager report" }
    ]);
  });

  it("runs and exports saved reports through the normal report service boundary", async () => {
    const { documents, savedReports } = createServices(["doc-1", "doc-2", "doc-3"], {
      savedReportIds: ["report-counts", "event-1"]
    });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Low Count", priority: "Low", count: 1 }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "High Count A", priority: "High", count: 3 }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "High Count B", priority: "High", count: 7 }) });
    const saved = await savedReports.save({
      actor: owner,
      doctype: "Note",
      label: "High counts",
      definition: {
        columns: [
          { name: "title", label: "Title" },
          { name: "count", label: "Count" },
          {
            name: "adjusted_count",
            label: "Adjusted Count",
            type: "number",
            formula: {
              operator: "add",
              left: { operator: "multiply", left: "count", right: 2 },
              right: 1
            }
          }
        ],
        filters: [
          { name: "priority", field: "priority", type: "select" },
          { name: "count_range", field: "count", type: "integer", operator: "between" }
        ],
        filterExpression: {
          kind: "group",
          match: "all",
          filters: [
            { filter: "priority", value: "High" },
            { filter: "count_range", value: [3, 8] }
          ]
        },
        summaries: [{ name: "total_count", label: "Total Count", aggregate: "sum", field: "count" }],
        orderBy: "count",
        order: "desc"
      }
    });

    const result = await savedReports.run({ actor: owner, doctype: "Note", id: saved.id, options: { limit: 1 } });

    expect(result).toMatchObject({
      report: { label: "High counts", doctype: "Note" },
      rows: [{ title: "High Count B", count: 7, adjusted_count: 15 }],
      summary: [{ name: "total_count", value: 10 }],
      total: 2
    });

    const csv = await savedReports.exportCsv({
      actor: owner,
      doctype: "Note",
      id: saved.id,
      options: { limit: 1 }
    });

    expect(csv).toMatchObject({ exported: 1, total: 2, truncated: true });
    expect(csv.body).toBe("Title,Count,Adjusted Count\nHigh Count B,7,15");
  });

  it("round-trips persisted group and chart bounds through saved report events", async () => {
    const { documents, savedReports } = createServices(["doc-1", "doc-2", "doc-3"], {
      savedReportIds: ["bounded", "event-1"]
    });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Alpha", count: 1 }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Beta", count: 2 }) });
    await documents.create({ actor: owner, doctype: "Note", data: data({ title: "Zeta", count: 10 }) });
    const saved = await savedReports.save({
      actor: owner,
      doctype: "Note",
      label: "Bounded counts",
      definition: {
        columns: [{ name: "title" }, { name: "count" }],
        groups: [
          {
            name: "by_title",
            field: "title",
            maxRows: 2,
            summaries: [{ name: "total_count", aggregate: "sum", field: "count" }]
          }
        ],
        charts: [
          {
            name: "largest_title_count",
            type: "bar",
            group: "by_title",
            summary: "total_count",
            maxPoints: 1,
            orderBy: "value",
            order: "desc",
            xAxisLabel: "Title",
            yAxisLabel: "Total Count"
          }
        ]
      }
    });

    const result = await savedReports.run({ actor: owner, doctype: "Note", id: saved.id });

    expect(result.groups).toMatchObject([
      {
        name: "by_title",
        rows: [
          { key: "Alpha", summaries: [{ name: "total_count", value: 1 }] },
          { key: "Beta", summaries: [{ name: "total_count", value: 2 }] }
        ]
      }
    ]);
    expect(result.charts).toMatchObject([
      {
        name: "largest_title_count",
        xAxisLabel: "Title",
        yAxisLabel: "Total Count",
        points: [{ key: "Zeta", value: 10 }]
      }
    ]);
  });

  it("updates and deletes only reports owned by the actor", async () => {
    const { savedReports } = createServices(["create-1"], {
      savedReportIds: ["report-1", "event-1", "event-2", "event-3"]
    });
    const saved = await savedReports.save({
      actor: owner,
      doctype: "Note",
      label: "Original",
      definition: { columns: [{ name: "title" }] }
    });

    await expect(
      savedReports.save({
        actor: manager,
        doctype: "Note",
        id: saved.id,
        label: "Manager overwrite",
        definition: { columns: [{ name: "priority" }] }
      })
    ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });

    const updated = await savedReports.save({
      actor: owner,
      doctype: "Note",
      id: saved.id,
      label: "Updated",
      definition: { columns: [{ name: "priority" }] }
    });

    expect(updated).toMatchObject({
      id: saved.id,
      label: "Updated",
      definition: { columns: [{ name: "priority" }] },
      createdAt: saved.createdAt
    });
    await expect(savedReports.get(manager, "Note", saved.id)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(savedReports.delete({ actor: manager, doctype: "Note", id: saved.id })).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND"
    });

    await savedReports.delete({ actor: owner, doctype: "Note", id: saved.id });

    await expect(savedReports.list(owner, "Note")).resolves.toEqual([]);
  });

  it("requires read permission, valid labels, and metadata-valid report definitions", async () => {
    const { savedReports } = createServices(["create-1"], {
      savedReportIds: ["report-1", "event-1"]
    });

    await expect(
      savedReports.save({
        actor: { id: "stranger@example.com", roles: ["Stranger"], tenantId: "acme" },
        doctype: "Note",
        label: "Guest report",
        definition: { columns: [{ name: "title" }] }
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      savedReports.save({ actor: owner, doctype: "Note", label: "  ", definition: { columns: [{ name: "title" }] } })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Saved report label is required"
    });
    await expect(
      savedReports.save({
        actor: owner,
        doctype: "Note",
        label: "Invalid",
        definition: { columns: [{ name: "missing" }] }
      })
    ).rejects.toMatchObject({
      code: "REPORT_INVALID",
      message: "Report 'Saved Report Draft' column 'missing' references unknown field 'missing'"
    });
    await expect(
      savedReports.save({
        actor: owner,
        doctype: "Note",
        label: "Bad formula",
        definition: {
          columns: [
            {
              name: "title_score",
              label: "Title Score",
              type: "number",
              formula: { operator: "add", left: "title", right: "count" }
            }
          ]
        }
      })
    ).rejects.toMatchObject({
      code: "REPORT_INVALID",
      message: "Report 'Saved Report Draft' formula column 'title_score' requires a numeric left field 'title'"
    });
    await expect(
      savedReports.save({
        actor: owner,
        doctype: "Note",
        label: "Bad aggregate",
        definition: {
          columns: [{ name: "title" }],
          summaries: [{ name: "median_count", aggregate: "median" as "sum", field: "count" }]
        }
      })
    ).rejects.toMatchObject({
      code: "REPORT_INVALID",
      message: "Report 'Saved Report Draft' summary 'median_count' has invalid aggregate 'median'"
    });
    await expect(
      savedReports.save({
        actor: owner,
        doctype: "Note",
        label: "Bad group aggregate",
        definition: {
          columns: [{ name: "title" }],
          groups: [
            {
              name: "by_priority",
              field: "priority",
              summaries: [{ name: "median_count", aggregate: "median" as "sum", field: "count" }]
            }
          ]
        }
      })
    ).rejects.toMatchObject({
      code: "REPORT_INVALID",
      message: "Report 'Saved Report Draft' summary 'median_count' on group 'by_priority' has invalid aggregate 'median'"
    });
  });

  it("rejects overly deep nested formulas while replaying saved report events", async () => {
    const { events, savedReports } = createServices();
    const stream = savedReportsStream("acme", "Note", owner.id);
    await events.append(stream, 0, [
      {
        id: "event-deep-report",
        tenantId: "acme",
        stream,
        type: "NoteSavedReportSaved",
        doctype: "Note",
        documentName: "report_deep",
        actorId: owner.id,
        occurredAt: now,
        payload: {
          kind: "SavedReportSaved",
          reportId: "report_deep",
          label: "Deep formula",
          ownerId: owner.id,
          definition: {
            columns: [
              {
                name: "too_deep",
                type: "number",
                formula: nestedFormulaPayload(REPORT_FORMULA_MAX_DEPTH + 1)
              }
            ]
          }
        },
        metadata: {}
      }
    ]);

    await expect(savedReports.list(owner, "Note")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining(`exceeds maximum formula depth of ${REPORT_FORMULA_MAX_DEPTH}`)
    });
  });

  it("rejects oversized filter expressions while replaying saved report events", async () => {
    const { events, savedReports } = createServices();
    const stream = savedReportsStream("acme", "Note", owner.id);
    await events.append(stream, 0, [
      {
        id: "event-wide-expression-report",
        tenantId: "acme",
        stream,
        type: "NoteSavedReportSaved",
        doctype: "Note",
        documentName: "report_wide",
        actorId: owner.id,
        occurredAt: now,
        payload: {
          kind: "SavedReportSaved",
          reportId: "report_wide",
          label: "Wide expression",
          ownerId: owner.id,
          definition: {
            columns: [{ name: "title" }],
            filters: [{ name: "priority", field: "priority" }],
            filterExpression: wideFilterExpressionPayload(REPORT_FILTER_EXPRESSION_MAX_NODES)
          }
        },
        metadata: {}
      }
    ]);

    await expect(savedReports.list(owner, "Note")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining(`or ${REPORT_FILTER_EXPRESSION_MAX_NODES} nodes`)
    });
  });

  it("rejects semantically invalid filter expressions while replaying saved report events", async () => {
    const { events, savedReports } = createServices();
    const stream = savedReportsStream("acme", "Note", owner.id);
    await events.append(stream, 0, [
      {
        id: "event-invalid-expression-report",
        tenantId: "acme",
        stream,
        type: "NoteSavedReportSaved",
        doctype: "Note",
        documentName: "report_invalid_expression",
        actorId: owner.id,
        occurredAt: now,
        payload: {
          kind: "SavedReportSaved",
          reportId: "report_invalid_expression",
          label: "Invalid expression",
          ownerId: owner.id,
          definition: {
            columns: [{ name: "title" }],
            filters: [{ name: "priority", field: "priority" }],
            filterExpression: { filter: "missing", value: "High" }
          }
        },
        metadata: {}
      }
    ]);

    await expect(savedReports.list(owner, "Note")).rejects.toMatchObject({
      code: "REPORT_INVALID",
      message: "Report 'Saved Report Draft' filter expression references unknown filter 'missing'"
    });
  });
});

function nestedFormulaPayload(depth: number): JsonObject {
  let formula: JsonObject = { operator: "add", left: "count", right: 1 };
  for (let index = 1; index < depth; index += 1) {
    formula = { operator: "add", left: formula, right: 1 };
  }
  return formula;
}

function wideFilterExpressionPayload(filterCount: number): JsonObject {
  return {
    kind: "group",
    match: "all",
    filters: Array.from({ length: filterCount }, () => ({ filter: "priority", value: "High" }))
  };
}
