import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote doctypes", () => {
  it("parses remote DocType metadata commands", () => {
    expect(parseCliArgs([
      "doctypes",
      "list",
      "--url",
      "https://app.example",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "doctypes",
      action: "list",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ]
    });

    expect(parseCliArgs([
      "doctypes",
      "list-view",
      "--url",
      "https://app.example",
      "--doctype",
      "Task Type"
    ])).toEqual({
      kind: "doctypes",
      action: "list-view",
      url: "https://app.example",
      headers: [],
      doctype: "Task Type"
    });
  });

  it("rejects invalid remote DocType options before fetching", () => {
    expect(parseCliArgs(["doctypes", "unknown", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Unknown doctypes command 'unknown'"
    });
    expect(parseCliArgs(["doctypes", "list"])).toEqual({
      kind: "invalid",
      message: "Missing value for --url"
    });
    expect(parseCliArgs(["doctypes", "get", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "DocType get requires --doctype"
    });
    expect(parseCliArgs(["doctypes", "list-view", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "DocType list-view requires --doctype"
    });
    expect(parseCliArgs([
      "doctypes",
      "list",
      "--url",
      "https://app.example",
      "--doctype",
      "Task"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --doctype with doctypes list"
    });
  });

  it("lists remote DocTypes through the generated metadata API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "doctypes",
        "list",
        "--url",
        "https://app.example/cf",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => "/workspace",
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeFetch(calls, {
          data: [
            {
              name: "Task",
              label: "Task",
              version: 3,
              fields: [{ name: "title", type: "text" }, { name: "project", type: "link", linkTo: "Project" }]
            },
            {
              name: "Project",
              label: "Project",
              fields: [{ name: "title", type: "text" }]
            }
          ]
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/cf/api/meta/doctypes");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(stdout.text()).toContain("DocTypes at https://app.example/cf");
    expect(stdout.text()).toContain("Total: 2");
    expect(stdout.text()).toContain("- Task fields=2 v3 - Task");
    expect(stdout.text()).toContain("- Project fields=1 - Project");
  });

  it("gets remote DocType metadata through the generated metadata API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "doctypes",
        "get",
        "--url",
        "https://app.example",
        "--doctype",
        "Task Type"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            name: "Task Type",
            label: "Task Type",
            module: "Tasks",
            version: 4,
            description: "Task metadata",
            fields: [
              {
                name: "title",
                label: "Title",
                description: "Human-readable task title.",
                type: "text",
                required: true,
                mandatoryDependsOn: { field: "project", operator: "is", value: "set" },
                readOnlyDependsOn: { field: "workflow_state", value: "Closed" },
                unique: true,
                noCopy: true,
                allowOnSubmit: true,
                fetchFrom: "project.title",
                fetchIfEmpty: true,
                inListView: true,
                inGlobalSearch: true
              },
              { name: "project", type: "link", linkTo: "Project", inListFilter: true },
              { name: "items", type: "table", tableOf: "Task Item", hidden: true }
            ],
            permissions: [{ roles: ["User"], actions: ["read"] }],
            commands: [{ name: "close" }],
            indexes: [["project"]],
            workflow: { initialState: "Open" }
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/api/meta/doctypes/Task%20Type");
    expect(stdout.text()).toContain("DocType at https://app.example");
    expect(stdout.text()).toContain("- Task Type fields=3 v4 - Task Type");
    expect(stdout.text()).toContain("Module: Tasks");
    expect(stdout.text()).toContain("Description: Task metadata");
    expect(stdout.text()).toContain('- title text [required,mandatoryDependsOn,readOnlyDependsOn,unique,noCopy,allowOnSubmit,fetchFrom=project.title,fetchIfEmpty,list,search] - Title help "Human-readable task title."');
    expect(stdout.text()).toContain("- project link -> Project [filter]");
    expect(stdout.text()).toContain("- items table -> Task Item [hidden]");
    expect(stdout.text()).toContain("Permissions: 1");
    expect(stdout.text()).toContain("Commands: 1");
    expect(stdout.text()).toContain("Indexes: 1");
    expect(stdout.text()).toContain("Workflow: yes");
  });

  it("gets remote DocType list-view metadata through the generated metadata API", async () => {
    const calls: RemoteCall[] = [];
    const stdout = textBuffer();
    const exitCode = await runCli(
      [
        "doctypes",
        "list-view",
        "--url",
        "https://app.example",
        "--doctype",
        "Task Type"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(calls, {
          data: {
            columns: [
              { name: "title", label: "Title", type: "text" },
              { name: "priority", type: "select" }
            ],
            filterFields: [{ name: "priority", type: "select" }],
            filterControls: [{ field: "priority" }],
            filterBuilderFields: [{ field: "priority" }],
            filters: [{ field: "status", operator: "eq", value: "Open" }],
            orderBy: "priority",
            order: "asc",
            orderOptions: [{ field: "priority" }, { field: "title" }],
            pageSize: 20
          }
        }),
        stdout,
        stderr: textBuffer()
      }
    );

    expect(exitCode).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example/api/meta/doctypes/Task%20Type/list-view");
    expect(stdout.text()).toContain("DocType list view at https://app.example");
    expect(stdout.text()).toContain("Task Type order=priority asc pageSize=20");
    expect(stdout.text()).toContain("Columns: 2");
    expect(stdout.text()).toContain("- title text - Title");
    expect(stdout.text()).toContain("- priority select");
    expect(stdout.text()).toContain("Filters: 1");
    expect(stdout.text()).toContain("Filter controls: 1");
    expect(stdout.text()).toContain("Filter builder fields: 1");
    expect(stdout.text()).toContain("Default filters: 1");
    expect(stdout.text()).toContain("Order options: 2");
  });

  it("maps remote DocType API errors and malformed responses to CLI failures", async () => {
    const forbidden = textBuffer();
    const forbiddenExitCode = await runCli(
      ["doctypes", "get", "--url", "https://app.example", "--doctype", "Secret"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "PERMISSION_DENIED", message: "Actor cannot read Secret metadata" }
        }, 403),
        stdout: textBuffer(),
        stderr: forbidden
      }
    );

    const malformedList = textBuffer();
    const malformedListExitCode = await runCli(
      ["doctypes", "list", "--url", "https://app.example"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], { data: { name: "Task" } }),
        stdout: textBuffer(),
        stderr: malformedList
      }
    );

    const malformedGet = textBuffer();
    const malformedGetExitCode = await runCli(
      ["doctypes", "get", "--url", "https://app.example", "--doctype", "Task"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], { data: [{ name: "Task" }] }),
        stdout: textBuffer(),
        stderr: malformedGet
      }
    );

    const malformedFields = textBuffer();
    const malformedFieldsExitCode = await runCli(
      ["doctypes", "get", "--url", "https://app.example", "--doctype", "Task"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], { data: { name: "Task", fields: "bad" } }),
        stdout: textBuffer(),
        stderr: malformedFields
      }
    );

    const malformedListViewFields = textBuffer();
    const malformedListViewFieldsExitCode = await runCli(
      ["doctypes", "list-view", "--url", "https://app.example", "--doctype", "Task"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], { data: { columns: [null] } }),
        stdout: textBuffer(),
        stderr: malformedListViewFields
      }
    );

    expect(forbiddenExitCode).toBe(1);
    expect(forbidden.text()).toContain(
      "Remote doctypes request failed (403): PERMISSION_DENIED: Actor cannot read Secret metadata"
    );
    expect(malformedListExitCode).toBe(1);
    expect(malformedList.text()).toContain("Remote doctypes response did not include a data array");
    expect(malformedGetExitCode).toBe(1);
    expect(malformedGet.text()).toContain("Remote doctype response did not include a data object");
    expect(malformedFieldsExitCode).toBe(1);
    expect(malformedFields.text()).toContain("Remote doctype fields response did not include an array");
    expect(malformedListViewFieldsExitCode).toBe(1);
    expect(malformedListViewFields.text()).toContain("Remote list-view columns response included a malformed field");
  });
});

interface RemoteCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body?: string;
}

function fakeFetch(calls: RemoteCall[], responseBody: unknown, status = 200): typeof fetch {
  return async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      ...(typeof init?.body === "string" ? { body: init.body } : {})
    });
    return new Response(JSON.stringify(responseBody), {
      headers: { "content-type": "application/json" },
      status
    });
  };
}

function textBuffer(): WritableText & { readonly text: () => string } {
  let value = "";
  return {
    write(chunk) {
      value += chunk;
    },
    text() {
      return value;
    }
  };
}
