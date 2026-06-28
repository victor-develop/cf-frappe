import { describe, expect, it } from "vitest";

import {
  compareSearchResults,
  clampCsvExportLimit,
  clampLimit,
  clampSearchLimit,
  defineDocType,
  documentCsvColumns,
  getField,
  getLinkField,
  globalSearchCandidates,
  globalSearchMatch,
  labelForLinkedDocument,
  matchesLinkSearch,
  mergeDefaultFilters,
  normalizeRequiredSearch,
  normalizeSearch,
  planDocumentReadProjection,
  planProjectionPageScan,
  primitiveCsvValue,
  searchableText,
  toGlobalSearchResult,
  toLinkOption,
  type DocumentSnapshot,
  type GlobalSearchResultItem
} from "../../src";

const Article = defineDocType({
  name: "Article",
  naming: { kind: "field", field: "slug" },
  fields: [
    { name: "slug", type: "text", label: "Slug", inGlobalSearch: true },
    { name: "summary", type: "text", label: "Summary", inGlobalSearch: true },
    { name: "metadata", type: "json", label: "Metadata" }
  ]
});

const article = snapshot("Article", "ART-1", {
  slug: "launch-plan",
  title: "Launch Plan",
  summary: "Saturn readiness",
  metadata: { owner: "ops" }
});

describe("document query policy", () => {
  it("builds CSV columns around list-view fields and primitive values", () => {
    const columns = documentCsvColumns(Article.fields);

    expect(columns.map((column) => column.label)).toEqual(["Name", "Slug", "Summary", "Metadata", "Version", "Updated"]);
    expect(columns.map((column) => column.value(article))).toEqual([
      "ART-1",
      "launch-plan",
      "Saturn readiness",
      "{\"owner\":\"ops\"}",
      1,
      "2026-06-28T01:00:00.000Z"
    ]);
  });

  it("normalizes primitive and structured CSV values", () => {
    expect(primitiveCsvValue(undefined)).toBeUndefined();
    expect(primitiveCsvValue(null)).toBeNull();
    expect(primitiveCsvValue("Apollo")).toBe("Apollo");
    expect(primitiveCsvValue(3)).toBe(3);
    expect(primitiveCsvValue(false)).toBe(false);
    expect(primitiveCsvValue(["A", "B"])).toBe("[\"A\",\"B\"]");
  });

  it("chooses document labels from title, naming field, then name", () => {
    expect(labelForLinkedDocument(article, Article)).toBe("Launch Plan");
    expect(labelForLinkedDocument({ ...article, data: { slug: "launch-plan" } }, Article)).toBe("launch-plan");
    expect(labelForLinkedDocument({ ...article, data: {} }, Article)).toBe("ART-1");
    expect(toLinkOption(article, Article)).toEqual({ value: "ART-1", label: "Launch Plan" });
  });

  it("plans missing projected document reads as not found", () => {
    expect(planDocumentReadProjection({ doctype: Article, name: "ART-404", document: null })).toEqual({
      status: "not-found",
      message: "Article/ART-404 was not found"
    });
  });

  it("plans deleted projected document reads as not found", () => {
    expect(
      planDocumentReadProjection({
        doctype: Article,
        name: "ART-1",
        document: { ...article, docstatus: "deleted" }
      })
    ).toEqual({
      status: "not-found",
      message: "Article/ART-1 was not found"
    });
  });

  it("plans live projected document reads for access checks", () => {
    expect(planDocumentReadProjection({ doctype: Article, name: "ART-1", document: article })).toEqual({
      status: "check-access",
      document: article
    });
  });

  it("plans projection page scans until the current page reaches the total", () => {
    expect(planProjectionPageScan({ offset: 0, pageSize: 200, total: 450 })).toEqual({
      status: "continue",
      nextOffset: 200
    });
    expect(planProjectionPageScan({ offset: 400, pageSize: 200, total: 450 })).toEqual({
      status: "complete"
    });
  });

  it("matches link searches against option values and labels", () => {
    const option = toLinkOption(article, Article);

    expect(matchesLinkSearch(option, "art")).toBe(true);
    expect(matchesLinkSearch(option, "launch")).toBe(true);
    expect(matchesLinkSearch(option, "missing")).toBe(false);
  });

  it("finds global-search candidates from names, titles, naming fields, and flagged fields", () => {
    expect(globalSearchCandidates(Article, article)).toEqual([
      { field: "name", text: "ART-1" },
      { field: "title", text: "Launch Plan" },
      { field: "slug", text: "launch-plan" },
      { field: "summary", text: "Saturn readiness" }
    ]);
    expect(globalSearchMatch(Article, article, "saturn")).toEqual({ field: "summary", text: "Saturn readiness" });
    expect(searchableText("  ")).toBeUndefined();
    expect(searchableText(true)).toBe("true");
  });

  it("builds and sorts global search results deterministically", () => {
    const older = toGlobalSearchResult(Article, article, { field: "summary", text: "Saturn readiness" });
    const newer = {
      ...older,
      name: "ART-2",
      label: "Alpha",
      updatedAt: "2026-06-29T01:00:00.000Z"
    };
    const sameTimeLaterLabel = { ...older, name: "ART-3", label: "Zulu" };

    expect(older).toMatchObject({
      doctype: "Article",
      name: "ART-1",
      label: "Launch Plan",
      matchedField: "summary",
      matchedText: "Saturn readiness",
      route: "/desk/Article/ART-1"
    });
    expect(([older, sameTimeLaterLabel, newer] satisfies GlobalSearchResultItem[]).sort(compareSearchResults))
      .toEqual([newer, older, sameTimeLaterLabel]);
  });

  it("normalizes query limits for list, CSV, and global search surfaces", () => {
    expect(clampLimit(undefined)).toBe(50);
    expect(clampLimit(500, 200)).toBe(200);
    expect(() => clampLimit(0)).toThrow("limit must be a positive integer");

    expect(clampCsvExportLimit(undefined)).toBe(10_000);
    expect(clampCsvExportLimit(20_000)).toBe(10_000);
    expect(() => clampCsvExportLimit(1.5)).toThrow("CSV export limit must be a positive integer");

    expect(clampSearchLimit(undefined)).toBe(20);
    expect(clampSearchLimit(120)).toBe(100);
    expect(() => clampSearchLimit(-1)).toThrow("Search limit must be a positive integer");
  });

  it("looks up fields and rejects non-link fields for link option queries", () => {
    expect(getField(Article, "summary")).toMatchObject({ name: "summary" });
    expect(() => getField(Article, "missing")).toThrow("Field 'missing' is not defined on Article");
    expect(() => getLinkField(Article, "summary")).toThrow("Field 'summary' on Article is not a link field");

    const Task = defineDocType({
      name: "Task",
      fields: [{ name: "article", type: "link", linkTo: "Article" }]
    });
    expect(getLinkField(Task, "article")).toMatchObject({ name: "article", linkTo: "Article" });
  });

  it("normalizes search strings and requires non-empty global search terms", () => {
    expect(normalizeSearch(undefined)).toBeUndefined();
    expect(normalizeSearch("  Saturn ")).toBe("saturn");
    expect(normalizeSearch("   ")).toBeUndefined();
    expect(normalizeRequiredSearch(" Apollo ")).toBe("apollo");
    expect(() => normalizeRequiredSearch(" ")).toThrow("Search query is required");
  });

  it("merges default and override list filters through the shared list-filter policy", () => {
    expect(
      mergeDefaultFilters(
        [{ field: "status", operator: "eq", value: "Open" }],
        [{ field: "priority", operator: "eq", value: "High" }]
      )
    ).toEqual([
      { field: "status", operator: "eq", value: "Open" },
      { field: "priority", operator: "eq", value: "High" }
    ]);
  });
});

function snapshot(doctype: string, name: string, data: DocumentSnapshot["data"]): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype,
    name,
    version: 1,
    docstatus: "draft",
    data,
    createdAt: "2026-06-28T01:00:00.000Z",
    updatedAt: "2026-06-28T01:00:00.000Z"
  };
}
