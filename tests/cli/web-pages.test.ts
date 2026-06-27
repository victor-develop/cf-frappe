import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote web pages", () => {
  it("parses remote web page commands", () => {
    expect(parseCliArgs(["web-pages", "list", "--url", "https://app.example"])).toEqual({
      kind: "web-pages",
      action: "list",
      url: "https://app.example",
      headers: []
    });
    expect(parseCliArgs([
      "web-pages",
      "get",
      "--url",
      "https://app.example",
      "--web-page",
      "About",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "web-pages",
      action: "get",
      url: "https://app.example",
      headers: [{ kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }],
      webPage: "About"
    });
    expect(parseCliArgs(["web-pages", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown web-pages command 'unknown'"
    });
    expect(parseCliArgs(["web-pages", "get", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Web page get requires --web-page"
    });
    expect(parseCliArgs(["web-pages", "list", "--url", "https://app.example", "--web-page", "About"])).toEqual({
      kind: "invalid",
      message: "Cannot use --web-page with web-pages list"
    });
  });

  it("reads remote web page metadata", async () => {
    const calls: string[] = [];
    const fetch = async (url: URL | RequestInfo) => {
      const requestUrl = url instanceof Request ? url.url : String(url);
      calls.push(requestUrl);
      if (requestUrl.endsWith("/api/meta/web-pages")) {
        return jsonResponse({ data: [{ name: "About", route: "about", title: "About" }] });
      }
      return jsonResponse({ data: { name: "About", route: "about", title: "About", description: "Public page" } });
    };

    const listStdout = textBuffer();
    expect(await runCli(["web-pages", "list", "--url", "https://app.example"], {
      stdout: listStdout,
      stderr: textBuffer(),
      cwd: () => process.cwd(),
      fetch
    })).toBe(0);
    expect(listStdout.text()).toContain("/page/about - About");

    const getStdout = textBuffer();
    expect(await runCli(["web-pages", "get", "--url", "https://app.example", "--web-page", "About"], {
      stdout: getStdout,
      stderr: textBuffer(),
      cwd: () => process.cwd(),
      fetch
    })).toBe(0);
    expect(getStdout.text()).toContain("Description: Public page");

    expect(calls).toEqual([
      "https://app.example/api/meta/web-pages",
      "https://app.example/api/meta/web-pages/About"
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
