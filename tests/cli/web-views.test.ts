import { parseCliArgs, runCli } from "../../src/cli/command";
import type { WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote web views", () => {
  it("parses remote web view commands", () => {
    expect(parseCliArgs(["web-views", "list", "--url", "https://app.example"])).toEqual({
      kind: "web-views",
      action: "list",
      url: "https://app.example",
      headers: []
    });
    expect(parseCliArgs([
      "web-views",
      "items",
      "--url",
      "https://app.example",
      "--web-view",
      "Articles",
      "--limit",
      "5",
      "--offset",
      "10",
      "--header",
      "Authorization: Bearer test"
    ])).toEqual({
      kind: "web-views",
      action: "items",
      url: "https://app.example",
      headers: [{ kind: "literal", name: "Authorization", value: "Bearer test" }],
      webView: "Articles",
      limit: 5,
      offset: 10
    });
    expect(parseCliArgs([
      "web-views",
      "item",
      "--url",
      "https://app.example",
      "--web-view",
      "Articles/View",
      "--route",
      "news/launch"
    ])).toEqual({
      kind: "web-views",
      action: "item",
      url: "https://app.example",
      headers: [],
      webView: "Articles/View",
      route: "news/launch"
    });
    expect(parseCliArgs(["web-views", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown web-views command 'unknown'"
    });
    expect(parseCliArgs(["web-views", "get", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Web view get requires --web-view"
    });
    expect(parseCliArgs(["web-views", "item", "--url", "https://app.example", "--web-view", "Articles"])).toEqual({
      kind: "invalid",
      message: "Web view item requires --route"
    });
    expect(parseCliArgs(["web-views", "list", "--url", "https://app.example", "--web-view", "Articles"])).toEqual({
      kind: "invalid",
      message: "Cannot use --web-view with web-views list"
    });
  });

  it("documents Web View item pagination options in CLI help", async () => {
    const stdout = textBuffer();
    expect(await runCli(["--help"], {
      stdout,
      stderr: textBuffer(),
      cwd: () => process.cwd()
    })).toBe(0);
    expect(stdout.text()).toContain(
      "cf-frappe web-views items --url <origin> --web-view <view> [--limit <n>] [--offset <n>]"
    );
  });

  it("reads remote web views through generated metadata and item APIs", async () => {
    const calls: Array<{ readonly url: string; readonly method: string }> = [];
    const fetch = async (url: URL | RequestInfo, init?: RequestInit) => {
      const requestUrl = url instanceof Request ? url.url : String(url);
      calls.push({ url: requestUrl, method: init?.method ?? "GET" });
      if (requestUrl.endsWith("/api/meta/web-views")) {
        return jsonResponse({ data: [{ name: "Articles", doctype: "Article", label: "Articles" }] });
      }
      if (requestUrl.endsWith("/api/meta/web-views/Articles")) {
        return jsonResponse({
          data: {
            view: {
              name: "Articles",
              label: "Articles",
              filters: [{ field: "category", value: "News" }],
              filterExpression: {
                kind: "group",
                match: "any",
                filters: [{ field: "title", operator: "contains", value: "Launch" }]
              },
              orderBy: "title",
              order: "asc"
            },
            doctype: "Article",
            routeField: { field: "route" },
            titleField: { field: "title" },
            fields: [{ field: "body", type: "longText", label: "Body" }]
          }
        });
      }
      if (requestUrl.endsWith("/api/meta/web-views/Recent")) {
        return jsonResponse({
          data: {
            view: { name: "Recent", label: "Recent", order: "asc" },
            doctype: "Article",
            routeField: { field: "route" },
            titleField: { field: "title" }
          }
        });
      }
      if (requestUrl.includes("/api/web-view/Articles") && !requestUrl.endsWith("/news/launch")) {
        return jsonResponse({
          data: {
            items: [{ route: "news/launch", title: "Launch", doctype: "Article", name: "Launch" }],
            total: 3,
            totalIsExact: false,
            limit: 2,
            offset: 1,
            nextOffset: 2
          }
        });
      }
      return jsonResponse({
        data: {
          view: { name: "Articles/View", doctype: "Article" },
          item: { route: "news/launch", title: "Launch", doctype: "Article", name: "Launch" }
        }
      });
    };

    const listStdout = textBuffer();
    expect(await runCli(["web-views", "list", "--url", "https://app.example"], {
      stdout: listStdout,
      stderr: textBuffer(),
      cwd: () => process.cwd(),
      fetch
    })).toBe(0);
    expect(listStdout.text()).toContain("Articles Article");

    const getStdout = textBuffer();
    expect(await runCli(["web-views", "get", "--url", "https://app.example", "--web-view", "Articles"], {
      stdout: getStdout,
      stderr: textBuffer(),
      cwd: () => process.cwd(),
      fetch
    })).toBe(0);
    expect(getStdout.text()).toContain("Route field: route");
    expect(getStdout.text()).toContain("Order: title asc");
    expect(getStdout.text()).toContain("Filters: 1");
    expect(getStdout.text()).toContain("Filter expression: yes");

    const orderOnlyStdout = textBuffer();
    expect(await runCli(["web-views", "get", "--url", "https://app.example", "--web-view", "Recent"], {
      stdout: orderOnlyStdout,
      stderr: textBuffer(),
      cwd: () => process.cwd(),
      fetch
    })).toBe(0);
    expect(orderOnlyStdout.text()).toContain("Order: updatedAt asc");
    expect(orderOnlyStdout.text()).toContain("Filter expression: no");

    const itemsStdout = textBuffer();
    expect(await runCli(["web-views", "items", "--url", "https://app.example", "--web-view", "Articles", "--limit", "2", "--offset", "1"], {
      stdout: itemsStdout,
      stderr: textBuffer(),
      cwd: () => process.cwd(),
      fetch
    })).toBe(0);
    expect(itemsStdout.text()).toContain("news/launch Article/Launch");
    expect(itemsStdout.text()).toContain("Total: 3+");
    expect(itemsStdout.text()).toContain("Offset: 1");
    expect(itemsStdout.text()).toContain("Next offset: 2");

    const itemStdout = textBuffer();
    expect(await runCli(["web-views", "item", "--url", "https://app.example", "--web-view", "Articles/View", "--route", "news/launch"], {
      stdout: itemStdout,
      stderr: textBuffer(),
      cwd: () => process.cwd(),
      fetch
    })).toBe(0);
    expect(itemStdout.text()).toContain("Launch");

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://app.example/api/meta/web-views",
      "GET https://app.example/api/meta/web-views/Articles",
      "GET https://app.example/api/meta/web-views/Recent",
      "GET https://app.example/api/web-view/Articles?limit=2&offset=1",
      "GET https://app.example/api/web-view/Articles%2FView/news/launch"
    ]);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" }
  });
}

function textBuffer(): WritableText & { readonly text: () => string } {
  let value = "";
  return {
    write(chunk: string) {
      value += chunk;
    },
    text() {
      return value;
    }
  };
}
