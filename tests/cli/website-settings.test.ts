import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote website settings", () => {
  it("parses remote website settings commands", () => {
    expect(parseCliArgs(["website-settings", "get", "--url", "https://app.example"])).toEqual({
      kind: "website-settings",
      action: "get",
      url: "https://app.example",
      headers: []
    });
    expect(parseCliArgs([
      "website-settings",
      "get",
      "--url",
      "https://app.example",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "website-settings",
      action: "get",
      url: "https://app.example",
      headers: [{ kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }]
    });
    expect(parseCliArgs(["website-settings", "list", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown website-settings command 'list'"
    });
  });

  it("reads remote website settings metadata", async () => {
    const calls: string[] = [];
    const fetch = async (url: URL | RequestInfo) => {
      const requestUrl = url instanceof Request ? url.url : String(url);
      calls.push(requestUrl);
      return jsonResponse({
        data: {
          title: "Starter Site",
          description: "Cloudflare-native starter",
          homePageRoute: "about",
          navItems: [{ name: "about", label: "About", href: "/page/about" }]
        }
      });
    };

    const stdout = textBuffer();
    expect(await runCli(["website-settings", "get", "--url", "https://app.example"], {
      stdout,
      stderr: textBuffer(),
      cwd: () => process.cwd(),
      fetch
    })).toBe(0);

    expect(stdout.text()).toContain("Title: Starter Site");
    expect(stdout.text()).toContain("Home: /page/about");
    expect(stdout.text()).toContain("- About /page/about");
    expect(calls).toEqual(["https://app.example/api/meta/website-settings"]);
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
