import { describe, expect, it } from "vitest";

import {
  compareSearchResults,
  defineDocType,
  documentCsvColumns,
  globalSearchCandidates,
  globalSearchMatch,
  labelForLinkedDocument,
  matchesLinkSearch,
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
