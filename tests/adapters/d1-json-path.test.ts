import { readFileSync, readdirSync } from "node:fs";
import { defineDocType, planD1ProjectionIndexes } from "../../src";
import {
  d1JsonExtract,
  d1JsonPathLiteral,
  d1JsonType
} from "../../src/adapters/d1/json-path.js";
import { d1ProjectionListQuery } from "../../src/adapters/d1/projection-query.js";
import { afterField } from "../predicate-fixtures";

describe("D1 JSON path expressions", () => {
  it("builds the one accepted form", () => {
    expect(d1JsonPathLiteral("status")).toBe("'$.status'");
    expect(d1JsonExtract("status")).toBe("json_extract(data_json, '$.status')");
    expect(d1JsonType("status")).toBe("json_type(data_json, '$.status')");
  });

  it("escapes quotes the way SQLite expects, identically on both sides", () => {
    // Unreachable through metadata validation today, but the index DDL and the
    // query predicate previously escaped this differently: '' on one side and
    // a backslash on the other, which is not even valid SQLite. Divergence here
    // silently stops the index from matching.
    expect(d1JsonExtract("a'b")).toBe("json_extract(data_json, '$.a''b')");
    expect(d1JsonType("a'b")).toBe("json_type(data_json, '$.a''b')");
  });

  it("produces the same expression in index DDL and in query predicates", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "status", type: "text" },
        { name: "customer id", type: "text" }
      ],
      indexes: [["status"], ["customer id"]]
    });

    for (const field of ["status", "customer id"]) {
      const expression = d1JsonExtract(field);
      const indexed = planD1ProjectionIndexes([Task]).some((statement) =>
        statement.sql.includes(expression)
      );
      const queried = d1ProjectionListQuery({
        tenantId: "t1",
        doctype: "Task",
        predicate: afterField(field, "x")
      }).where.includes(expression);

      expect(indexed, `index DDL is missing ${expression}`).toBe(true);
      expect(queried, `query WHERE is missing ${expression}`).toBe(true);
    }
  });

  it("orders by the same expression it filters on", () => {
    const query = d1ProjectionListQuery({
      tenantId: "t1",
      doctype: "Task",
      predicate: afterField("status", "Open"),
      orderBy: "status"
    });

    expect(query.where).toContain(d1JsonExtract("status"));
    expect(query.orderBy).toContain(d1JsonExtract("status"));
  });

  it("keeps the D1 adapter free of hand-written JSON operators", () => {
    // `data_json->>'$.status'` is semantically identical but textually different,
    // so it silently stops matching the generated indexes. Nothing else fails.
    const offenders: string[] = [];
    const directory = new URL("../../src/adapters/d1/", import.meta.url);
    for (const entry of readdirSync(directory)) {
      if (!entry.endsWith(".ts")) {
        continue;
      }
      const source = stripComments(readFileSync(new URL(entry, directory), "utf8"));
      for (const [index, line] of source.split("\n").entries()) {
        if (/->>?/.test(line)) {
          offenders.push(`${entry}:${index + 1}: ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

/** Comments may name the banned operators; only code may not use them. */
function stripComments(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}
