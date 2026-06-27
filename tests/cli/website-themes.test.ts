import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote website themes", () => {
  it("parses remote website theme commands", () => {
    expect(parseCliArgs(["website-themes", "list", "--url", "https://app.example"])).toEqual({
      kind: "website-themes",
      action: "list",
      url: "https://app.example",
      headers: []
    });
    expect(parseCliArgs(["website-themes", "get", "--url", "https://app.example", "--theme", "Starter"])).toEqual({
      kind: "website-themes",
      action: "get",
      url: "https://app.example",
      headers: [],
      theme: "Starter"
    });
    expect(parseCliArgs(["website-themes", "get", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Website theme get requires --theme"
    });
    expect(parseCliArgs(["website-themes", "list", "--url", "https://app.example", "--theme", "Starter"])).toEqual({
      kind: "invalid",
      message: "Cannot use --theme with website-themes list"
    });
  });

  it("reads remote website theme metadata", async () => {
    const calls: string[] = [];
    const fetch = async (url: URL | RequestInfo) => {
      const requestUrl = url instanceof Request ? url.url : String(url);
      calls.push(requestUrl);
      if (requestUrl.endsWith("/api/meta/website-themes")) {
        return jsonResponse({ data: [{ name: "Starter", label: "Starter" }] });
      }
      return jsonResponse({
        data: {
          name: "Starter",
          label: "Starter",
          fontFamily: "Inter, system-ui",
          tokens: { primaryColor: "#2563eb" }
        }
      });
    };

    const listStdout = textBuffer();
    expect(await runCli(["website-themes", "list", "--url", "https://app.example"], {
      stdout: listStdout,
      stderr: textBuffer(),
      cwd: () => process.cwd(),
      fetch
    })).toBe(0);
    expect(listStdout.text()).toContain("- Starter - Starter");

    const getStdout = textBuffer();
    expect(await runCli(["website-themes", "get", "--url", "https://app.example", "--theme", "Starter"], {
      stdout: getStdout,
      stderr: textBuffer(),
      cwd: () => process.cwd(),
      fetch
    })).toBe(0);
    expect(getStdout.text()).toContain("primaryColor: #2563eb");
    expect(calls).toEqual([
      "https://app.example/api/meta/website-themes",
      "https://app.example/api/meta/website-themes/Starter"
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
