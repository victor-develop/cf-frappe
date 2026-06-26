import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCliArgs, runCli, type WritableText } from "../../src/cli/command";

describe("cf-frappe CLI remote resources", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "cf-frappe-resources-cli-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { force: true, recursive: true });
  });

  it("parses remote resource CRUD commands", () => {
    expect(parseCliArgs([
      "resources",
      "list",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--filter",
      "status=Open",
      "--filter",
      "priority__ne=Low",
      "--filter-expression-json",
      "{\"kind\":\"group\",\"match\":\"all\",\"filters\":[]}",
      "--saved-filter",
      "open-tasks",
      "--limit",
      "10",
      "--offset",
      "5",
      "--order-by",
      "priority",
      "--order",
      "desc",
      "--no-default-filters",
      "--header",
      "x-cf-frappe-tenant: acme",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "resources",
      action: "list",
      url: "https://app.example",
      headers: [
        { kind: "literal", name: "x-cf-frappe-tenant", value: "acme" },
        { kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }
      ],
      doctype: "Task",
      filters: [
        { key: "status", value: "Open" },
        { key: "priority__ne", value: "Low" }
      ],
      filterExpression: { kind: "group", match: "all", filters: [] },
      savedFilter: "open-tasks",
      limit: 10,
      offset: 5,
      orderBy: "priority",
      order: "desc",
      useDefaultFilters: false
    });

    expect(parseCliArgs([
      "resources",
      "get",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK/001"
    ])).toEqual({
      kind: "resources",
      action: "get",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      name: "TASK/001"
    });

    expect(parseCliArgs([
      "resources",
      "create",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--data-json",
      "{\"title\":\"Ship it\"}"
    ])).toEqual({
      kind: "resources",
      action: "create",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      data: { title: "Ship it" }
    });

    expect(parseCliArgs([
      "resources",
      "update",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK-1",
      "--data-json",
      "{\"status\":\"Closed\"}",
      "--expected-version",
      "3"
    ])).toEqual({
      kind: "resources",
      action: "update",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      name: "TASK-1",
      data: { status: "Closed" },
      expectedVersion: 3
    });

    expect(parseCliArgs([
      "resources",
      "transition",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK-1",
      "--transition",
      "close",
      "--expected-version",
      "4"
    ])).toEqual({
      kind: "resources",
      action: "transition",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      name: "TASK-1",
      transition: "close",
      expectedVersion: 4
    });

    expect(parseCliArgs([
      "resources",
      "command",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK-1",
      "--command",
      "raisePriority",
      "--data-json",
      "{\"priority\":\"High\"}",
      "--expected-version",
      "5"
    ])).toEqual({
      kind: "resources",
      action: "command",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      name: "TASK-1",
      command: "raisePriority",
      data: { priority: "High" },
      expectedVersion: 5
    });

    expect(parseCliArgs([
      "resources",
      "duplicate",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK-1",
      "--new-name",
      "TASK-1 Copy",
      "--data-json",
      "{\"title\":\"Copied\"}"
    ])).toEqual({
      kind: "resources",
      action: "duplicate",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      name: "TASK-1",
      data: { title: "Copied" },
      newName: "TASK-1 Copy"
    });

    expect(parseCliArgs([
      "resources",
      "export",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--filter",
      "status=Open",
      "--filter-expression-json",
      "{\"kind\":\"group\",\"match\":\"all\",\"filters\":[]}",
      "--saved-filter",
      "open-tasks",
      "--limit",
      "50",
      "--order-by",
      "modified",
      "--order",
      "desc",
      "--no-default-filters",
      "--output",
      "task-export.csv",
      "--header-env",
      "Authorization=CF_FRAPPE_AUTH"
    ])).toEqual({
      kind: "resources",
      action: "export",
      url: "https://app.example",
      headers: [{ kind: "env", name: "Authorization", envName: "CF_FRAPPE_AUTH" }],
      doctype: "Task",
      filters: [{ key: "status", value: "Open" }],
      filterExpression: { kind: "group", match: "all", filters: [] },
      savedFilter: "open-tasks",
      limit: 50,
      orderBy: "modified",
      order: "desc",
      useDefaultFilters: false,
      outputPath: "task-export.csv"
    });

    expect(parseCliArgs([
      "resources",
      "import-template",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--output",
      "task-template.csv"
    ])).toEqual({
      kind: "resources",
      action: "import-template",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      outputPath: "task-template.csv"
    });

    expect(parseCliArgs([
      "resources",
      "import",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--path",
      "task-import.csv",
      "--mode",
      "update",
      "--max-rows",
      "25"
    ])).toEqual({
      kind: "resources",
      action: "import",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      path: "task-import.csv",
      importMode: "update",
      maxRows: 25
    });

    expect(parseCliArgs([
      "resources",
      "saved-filters",
      "--url",
      "https://app.example",
      "--doctype",
      "Task"
    ])).toEqual({
      kind: "resources",
      action: "saved-filters",
      url: "https://app.example",
      headers: [],
      doctype: "Task"
    });

    expect(parseCliArgs([
      "resources",
      "save-filter",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--label",
      "Open tasks",
      "--filter",
      "status=Open",
      "--filter",
      "priority__in=High",
      "--filter",
      "priority__in=Medium",
      "--filter-expression-json",
      "{\"kind\":\"group\",\"match\":\"all\",\"filters\":[{\"field\":\"status\",\"value\":\"Open\"}]}"
    ])).toEqual({
      kind: "resources",
      action: "save-filter",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      label: "Open tasks",
      filters: [
        { key: "status", value: "Open" },
        { key: "priority__in", value: "High" },
        { key: "priority__in", value: "Medium" }
      ],
      filterExpression: { kind: "group", match: "all", filters: [{ field: "status", value: "Open" }] }
    });

    expect(parseCliArgs([
      "resources",
      "delete-filter",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--filter-id",
      "filter/1"
    ])).toEqual({
      kind: "resources",
      action: "delete-filter",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      filterId: "filter/1"
    });

    expect(parseCliArgs([
      "resources",
      "shares",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK/1"
    ])).toEqual({
      kind: "resources",
      action: "shares",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      name: "TASK/1"
    });

    expect(parseCliArgs([
      "resources",
      "share",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK/1",
      "--user-id",
      "collab@example.com",
      "--permission",
      "read",
      "--permission",
      "write",
      "--expected-version",
      "2"
    ])).toEqual({
      kind: "resources",
      action: "share",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      name: "TASK/1",
      userId: "collab@example.com",
      permissions: ["read", "write"],
      expectedVersion: 2
    });

    expect(parseCliArgs([
      "resources",
      "unshare",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK/1",
      "--user-id",
      "collab@example.com",
      "--expected-version",
      "3"
    ])).toEqual({
      kind: "resources",
      action: "unshare",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      name: "TASK/1",
      userId: "collab@example.com",
      expectedVersion: 3
    });

    expect(parseCliArgs([
      "resources",
      "bulk-transition",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--transition",
      "close",
      "--document",
      "TASK-1",
      "--document-version",
      "TASK/2:7"
    ])).toEqual({
      kind: "resources",
      action: "bulk-transition",
      url: "https://app.example",
      headers: [],
      doctype: "Task",
      transition: "close",
      documents: [
        { name: "TASK-1" },
        { name: "TASK/2", expectedVersion: 7 }
      ]
    });
  });

  it("rejects invalid remote resource options before fetching", () => {
    expect(parseCliArgs(["resources", "list", "--url", "https://app.example"])).toEqual({
      kind: "invalid",
      message: "Resource command requires --doctype"
    });
    expect(parseCliArgs(["resources", "get", "--url", "https://app.example", "--doctype", "Task"])).toEqual({
      kind: "invalid",
      message: "Resource get requires --name"
    });
    expect(parseCliArgs(["resources", "create", "--url", "https://app.example", "--doctype", "Task"])).toEqual({
      kind: "invalid",
      message: "Resource create requires --data-json"
    });
    expect(parseCliArgs([
      "resources",
      "delete",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK-1",
      "--data-json",
      "{}"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --data-json with resources delete"
    });
    expect(parseCliArgs([
      "resources",
      "list",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--filter",
      "status"
    ])).toEqual({
      kind: "invalid",
      message: "Resource filter must use <field[__operator]>=<value>"
    });
    expect(parseCliArgs([
      "resources",
      "list",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--order",
      "sideways"
    ])).toEqual({
      kind: "invalid",
      message: "Resource list order must be asc or desc"
    });
    expect(parseCliArgs([
      "resources",
      "transition",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK-1"
    ])).toEqual({
      kind: "invalid",
      message: "Resource transition requires --transition"
    });
    expect(parseCliArgs([
      "resources",
      "command",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK-1"
    ])).toEqual({
      kind: "invalid",
      message: "Resource command requires --command"
    });
    expect(parseCliArgs([
      "resources",
      "bulk-delete",
      "--url",
      "https://app.example",
      "--doctype",
      "Task"
    ])).toEqual({
      kind: "invalid",
      message: "Resource bulk-delete requires at least one --document or --document-version"
    });
    expect(parseCliArgs([
      "resources",
      "export",
      "--url",
      "https://app.example",
      "--doctype",
      "Task"
    ])).toEqual({
      kind: "invalid",
      message: "Resource export requires --output"
    });
    expect(parseCliArgs([
      "resources",
      "import-template",
      "--url",
      "https://app.example",
      "--doctype",
      "Task"
    ])).toEqual({
      kind: "invalid",
      message: "Resource import-template requires --output"
    });
    expect(parseCliArgs([
      "resources",
      "import",
      "--url",
      "https://app.example",
      "--doctype",
      "Task"
    ])).toEqual({
      kind: "invalid",
      message: "Resource import requires --path"
    });
    expect(parseCliArgs([
      "resources",
      "import",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--path",
      "tasks.csv",
      "--mode",
      "merge"
    ])).toEqual({
      kind: "invalid",
      message: "Resource import mode must be create or update"
    });
    expect(parseCliArgs([
      "resources",
      "import",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--path",
      "tasks.csv",
      "--max-rows",
      "0"
    ])).toEqual({
      kind: "invalid",
      message: "Resource import max rows must be a positive integer"
    });
    expect(parseCliArgs([
      "resources",
      "export",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--output",
      "tasks.csv",
      "--offset",
      "10"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --offset with resources export"
    });
    expect(parseCliArgs([
      "resources",
      "list",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--output",
      "tasks.csv"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --output with resources list"
    });
    expect(parseCliArgs([
      "resources",
      "get",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK-1",
      "--saved-filter",
      "open-tasks"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --saved-filter with resources get"
    });
    expect(parseCliArgs([
      "resources",
      "save-filter",
      "--url",
      "https://app.example",
      "--doctype",
      "Task"
    ])).toEqual({
      kind: "invalid",
      message: "Resource save-filter requires --label"
    });
    expect(parseCliArgs([
      "resources",
      "delete-filter",
      "--url",
      "https://app.example",
      "--doctype",
      "Task"
    ])).toEqual({
      kind: "invalid",
      message: "Resource delete-filter requires --filter-id"
    });
    expect(parseCliArgs([
      "resources",
      "saved-filters",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--filter",
      "status=Open"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --filter with resources saved-filters"
    });
    expect(parseCliArgs([
      "resources",
      "save-filter",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--label",
      "Open tasks",
      "--saved-filter",
      "existing"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --saved-filter with resources save-filter"
    });
    expect(parseCliArgs([
      "resources",
      "share",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK-1"
    ])).toEqual({
      kind: "invalid",
      message: "Resource share requires --user-id"
    });
    expect(parseCliArgs([
      "resources",
      "unshare",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK-1"
    ])).toEqual({
      kind: "invalid",
      message: "Resource unshare requires --user-id"
    });
    expect(parseCliArgs([
      "resources",
      "shares",
      "--url",
      "https://app.example",
      "--doctype",
      "Task"
    ])).toEqual({
      kind: "invalid",
      message: "Resource shares requires --name"
    });
    expect(parseCliArgs([
      "resources",
      "unshare",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--name",
      "TASK-1",
      "--user-id",
      "collab@example.com",
      "--permission",
      "read"
    ])).toEqual({
      kind: "invalid",
      message: "Cannot use --permission with resources unshare"
    });
    expect(parseCliArgs([
      "resources",
      "bulk-submit",
      "--url",
      "https://app.example",
      "--doctype",
      "Task",
      "--document-version",
      "TASK-1"
    ])).toEqual({
      kind: "invalid",
      message: "Resource version selection must use <docname>:<expectedVersion>"
    });
  });

  it("lists and gets remote DocType resources through the generated resource API", async () => {
    const listCalls: RemoteCall[] = [];
    const listStdout = textBuffer();
    const listExit = await runCli(
      [
        "resources",
        "list",
        "--url",
        "https://app.example/cf",
        "--doctype",
        "Task",
        "--filter",
        "status=Open",
        "--filter",
        "body=",
        "--limit",
        "2",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => "/workspace",
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeFetch(listCalls, {
          data: [
            { name: "TASK-1", version: 1, docstatus: "draft", data: { title: "First" } },
            { name: "TASK-2", version: 2, docstatus: "submitted", data: { title: "Second" } }
          ],
          limit: 2,
          offset: 0,
          total: 7
        }),
        stdout: listStdout,
        stderr: textBuffer()
      }
    );

    expect(listExit).toBe(0);
    expect(listCalls[0]?.url).toBe(
      "https://app.example/cf/api/resource/Task?filter_status=Open&filter_body=&empty_filter=filter_body&limit=2"
    );
    expect(listCalls[0]?.method).toBe("GET");
    expect(listCalls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(listStdout.text()).toContain("Resources Task at https://app.example/cf");
    expect(listStdout.text()).toContain("Total: 7 Offset: 0 Limit: 2");
    expect(listStdout.text()).toContain("- TASK-2 version 2 status submitted");
    expect(listStdout.text()).toContain("{\"name\":\"TASK-1\"");

    const getCalls: RemoteCall[] = [];
    const getStdout = textBuffer();
    const getExit = await runCli(
      ["resources", "get", "--url", "https://app.example", "--doctype", "Task", "--name", "TASK/001"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(getCalls, {
          data: { name: "TASK/001", version: 3, docstatus: "draft", data: { title: "Encoded" } }
        }),
        stdout: getStdout,
        stderr: textBuffer()
      }
    );

    expect(getExit).toBe(0);
    expect(getCalls[0]?.url).toBe("https://app.example/api/resource/Task/TASK%2F001");
    expect(getStdout.text()).toContain("Resource Task at https://app.example");
    expect(getStdout.text()).toContain("- TASK/001 version 3 status draft");
  });

  it("creates, updates, and deletes remote DocType resources through the generated resource API", async () => {
    const createCalls: RemoteCall[] = [];
    const createStdout = textBuffer();
    const createExit = await runCli(
      [
        "resources",
        "create",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--data-json",
        "{\"name\":\"TASK-1\",\"title\":\"First\"}"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(createCalls, {
          data: { name: "TASK-1", version: 1, docstatus: "draft", data: { title: "First" } }
        }, 201),
        stdout: createStdout,
        stderr: textBuffer()
      }
    );

    expect(createExit).toBe(0);
    expect(createCalls[0]?.url).toBe("https://app.example/api/resource/Task");
    expect(createCalls[0]?.method).toBe("POST");
    expect(createCalls[0]?.body).toBe("{\"name\":\"TASK-1\",\"title\":\"First\"}");
    expect(createStdout.text()).toContain("Created resource Task at https://app.example");

    const updateCalls: RemoteCall[] = [];
    const updateExit = await runCli(
      [
        "resources",
        "update",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--name",
        "TASK-1",
        "--data-json",
        "{\"status\":\"Closed\"}",
        "--expected-version",
        "1"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(updateCalls, {
          data: { name: "TASK-1", version: 2, docstatus: "draft", data: { status: "Closed" } }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(updateExit).toBe(0);
    expect(updateCalls[0]?.url).toBe("https://app.example/api/resource/Task/TASK-1");
    expect(updateCalls[0]?.method).toBe("PUT");
    expect(updateCalls[0]?.body).toBe("{\"status\":\"Closed\",\"expectedVersion\":1}");

    const deleteCalls: RemoteCall[] = [];
    const deleteExit = await runCli(
      [
        "resources",
        "delete",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--name",
        "TASK-1",
        "--expected-version",
        "2"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(deleteCalls, {
          data: { name: "TASK-1", version: 3, docstatus: "draft", data: { title: "First" } }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(deleteExit).toBe(0);
    expect(deleteCalls[0]?.url).toBe("https://app.example/api/resource/Task/TASK-1");
    expect(deleteCalls[0]?.method).toBe("DELETE");
    expect(deleteCalls[0]?.body).toBe("{\"expectedVersion\":2}");
  });

  it("runs lifecycle, workflow, and custom commands through the generated resource API", async () => {
    const submitCalls: RemoteCall[] = [];
    const submitExit = await runCli(
      [
        "resources",
        "submit",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--name",
        "TASK/001",
        "--expected-version",
        "2"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(submitCalls, {
          data: { name: "TASK/001", version: 3, docstatus: "submitted", data: { title: "First" } }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(submitExit).toBe(0);
    expect(submitCalls[0]?.url).toBe("https://app.example/api/resource/Task/TASK%2F001/submit");
    expect(submitCalls[0]?.method).toBe("POST");
    expect(submitCalls[0]?.body).toBe("{\"expectedVersion\":2}");

    const transitionCalls: RemoteCall[] = [];
    const transitionStdout = textBuffer();
    const transitionExit = await runCli(
      [
        "resources",
        "transition",
        "--url",
        "https://app.example",
        "--doctype",
        "Task Type",
        "--name",
        "TASK-1",
        "--transition",
        "close now"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(transitionCalls, {
          data: { name: "TASK-1", version: 4, docstatus: "submitted", data: { workflow_state: "Closed" } }
        }),
        stdout: transitionStdout,
        stderr: textBuffer()
      }
    );

    expect(transitionExit).toBe(0);
    expect(transitionCalls[0]?.url).toBe("https://app.example/api/resource/Task%20Type/TASK-1/transition/close%20now");
    expect(transitionCalls[0]?.body).toBe("{}");
    expect(transitionStdout.text()).toContain("Transitioned resource Task Type at https://app.example");

    const commandCalls: RemoteCall[] = [];
    const commandExit = await runCli(
      [
        "resources",
        "command",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--name",
        "TASK-1",
        "--command",
        "raisePriority",
        "--data-json",
        "{\"priority\":\"High\"}",
        "--expected-version",
        "4"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(commandCalls, {
          data: { name: "TASK-1", version: 5, docstatus: "submitted", data: { priority: "High" } }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(commandExit).toBe(0);
    expect(commandCalls[0]?.url).toBe("https://app.example/api/resource/Task/TASK-1/command/raisePriority");
    expect(commandCalls[0]?.body).toBe("{\"priority\":\"High\",\"expectedVersion\":4}");

    const cancelCalls: RemoteCall[] = [];
    const cancelExit = await runCli(
      ["resources", "cancel", "--url", "https://app.example", "--doctype", "Task", "--name", "TASK-1"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(cancelCalls, {
          data: { name: "TASK-1", version: 6, docstatus: "cancelled", data: { title: "First" } }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(cancelExit).toBe(0);
    expect(cancelCalls[0]?.url).toBe("https://app.example/api/resource/Task/TASK-1/cancel");
    expect(cancelCalls[0]?.body).toBe("{}");
  });

  it("duplicates, amends, and bulk-runs remote DocType resources through the generated resource API", async () => {
    const duplicateCalls: RemoteCall[] = [];
    const duplicateStdout = textBuffer();
    const duplicateExit = await runCli(
      [
        "resources",
        "duplicate",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--name",
        "TASK-1",
        "--new-name",
        "TASK-1 Copy",
        "--data-json",
        "{\"title\":\"Copied\"}",
        "--expected-version",
        "1"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(duplicateCalls, {
          data: { name: "TASK-1 Copy", version: 1, docstatus: "draft", data: { title: "Copied" } }
        }, 201),
        stdout: duplicateStdout,
        stderr: textBuffer()
      }
    );

    expect(duplicateExit).toBe(0);
    expect(duplicateCalls[0]?.url).toBe("https://app.example/api/resource/Task/TASK-1/duplicate");
    expect(duplicateCalls[0]?.body).toBe("{\"data\":{\"title\":\"Copied\"},\"newName\":\"TASK-1 Copy\",\"expectedVersion\":1}");
    expect(duplicateStdout.text()).toContain("Duplicated resource Task at https://app.example");

    const amendCalls: RemoteCall[] = [];
    const amendExit = await runCli(
      [
        "resources",
        "amend",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--name",
        "TASK-1",
        "--new-name",
        "TASK-1 Rev 1"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(amendCalls, {
          data: { name: "TASK-1 Rev 1", version: 1, docstatus: "draft", data: { amended_from: "TASK-1" } }
        }, 201),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(amendExit).toBe(0);
    expect(amendCalls[0]?.url).toBe("https://app.example/api/resource/Task/TASK-1/amend");
    expect(amendCalls[0]?.body).toBe("{\"newName\":\"TASK-1 Rev 1\"}");

    const bulkCalls: RemoteCall[] = [];
    const bulkStdout = textBuffer();
    const bulkExit = await runCli(
      [
        "resources",
        "bulk-transition",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--transition",
        "close",
        "--document",
        "TASK-1",
        "--document-version",
        "TASK/2:7"
      ],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(bulkCalls, {
          data: {
            succeeded: [
              { name: "TASK-1", snapshot: { name: "TASK-1", version: 2, docstatus: "draft", data: { workflow_state: "Closed" } } }
            ],
            failed: [{ name: "TASK/2", code: "DOCUMENT_CONFLICT", status: 409, message: "Stale version" }]
          }
        }),
        stdout: bulkStdout,
        stderr: textBuffer()
      }
    );

    expect(bulkExit).toBe(0);
    expect(bulkCalls[0]?.url).toBe("https://app.example/api/resource/Task/bulk-transition/close");
    expect(bulkCalls[0]?.body).toBe("{\"documents\":[{\"name\":\"TASK-1\"},{\"name\":\"TASK/2\",\"expectedVersion\":7}]}");
    expect(bulkStdout.text()).toContain("Transitioned resources at https://app.example");
    expect(bulkStdout.text()).toContain("Succeeded: 1");
    expect(bulkStdout.text()).toContain("- TASK/2 failed DOCUMENT_CONFLICT status 409: Stale version");

    const bulkDeleteCalls: RemoteCall[] = [];
    const bulkDeleteExit = await runCli(
      ["resources", "bulk-delete", "--url", "https://app.example", "--doctype", "Task", "--document-version", "TASK-1:2"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch(bulkDeleteCalls, {
          data: {
            deleted: [{ name: "TASK-1", snapshot: { name: "TASK-1", version: 3, docstatus: "deleted" } }],
            failed: []
          }
        }),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(bulkDeleteExit).toBe(0);
    expect(bulkDeleteCalls[0]?.url).toBe("https://app.example/api/resource/Task/delete");
    expect(bulkDeleteCalls[0]?.body).toBe("{\"documents\":[{\"name\":\"TASK-1\",\"expectedVersion\":2}]}");
  });

  it("exports, downloads import templates, and imports CSV through the generated resource API", async () => {
    const exportCalls: RemoteCall[] = [];
    const exportStdout = textBuffer();
    const exportExit = await runCli(
      [
        "resources",
        "export",
        "--url",
        "https://app.example/cf",
        "--doctype",
        "Task",
        "--filter",
        "status=Open",
        "--saved-filter",
        "open-tasks",
        "--limit",
        "2",
        "--order-by",
        "modified",
        "--order",
        "desc",
        "--no-default-filters",
        "--output",
        "tasks.csv",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => tempRoot,
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeTextFetch(exportCalls, "name,status\nTASK-1,Open\n", {
          "content-type": "text/csv; charset=utf-8"
        }),
        stdout: exportStdout,
        stderr: textBuffer()
      }
    );

    expect(exportExit).toBe(0);
    expect(exportCalls[0]?.url).toBe(
      "https://app.example/cf/api/resource/Task/export.csv?filter_status=Open&saved_filter=open-tasks&limit=2&order_by=modified&order=desc&default_filters=0"
    );
    expect(exportCalls[0]?.method).toBe("GET");
    expect(exportCalls[0]?.headers.get("accept")).toBe("*/*");
    expect(exportCalls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    await expect(readFile(join(tempRoot, "tasks.csv"), "utf8")).resolves.toBe("name,status\nTASK-1,Open\n");
    expect(exportStdout.text()).toContain("Downloaded resource CSV export from https://app.example/cf");
    expect(exportStdout.text()).toContain("Task -> ");
    expect(exportStdout.text()).toContain("type text/csv; charset=utf-8");

    const templateCalls: RemoteCall[] = [];
    const templateStdout = textBuffer();
    const templateExit = await runCli(
      [
        "resources",
        "import-template",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--output",
        "task-template.csv"
      ],
      {
        cwd: () => tempRoot,
        fetch: fakeTextFetch(templateCalls, "name,expectedVersion,title\n", {
          "content-type": "text/csv"
        }),
        stdout: templateStdout,
        stderr: textBuffer()
      }
    );

    expect(templateExit).toBe(0);
    expect(templateCalls[0]?.url).toBe("https://app.example/api/resource/Task/import-template.csv");
    await expect(readFile(join(tempRoot, "task-template.csv"), "utf8")).resolves.toBe("name,expectedVersion,title\n");
    expect(templateStdout.text()).toContain("Downloaded resource CSV import template from https://app.example");

    await writeFile(join(tempRoot, "task-import.csv"), "name,expectedVersion,status\nTASK-1,1,Closed\n");
    const importCalls: RemoteCall[] = [];
    const importStdout = textBuffer();
    const importExit = await runCli(
      [
        "resources",
        "import",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--path",
        "task-import.csv",
        "--mode",
        "update",
        "--max-rows",
        "25"
      ],
      {
        cwd: () => tempRoot,
        fetch: fakeFetch(importCalls, {
          data: {
            doctype: "Task",
            mode: "update",
            total: 2,
            succeeded: [{ row: 2, action: "update", name: "TASK-1" }],
            failed: [{ row: 3, action: "update", name: "TASK-2", code: "BAD_REQUEST", status: 400, message: "Invalid count" }]
          }
        }, 207),
        stdout: importStdout,
        stderr: textBuffer()
      }
    );

    expect(importExit).toBe(0);
    expect(importCalls[0]?.url).toBe("https://app.example/api/resource/Task/import.csv?mode=update&max_rows=25");
    expect(importCalls[0]?.method).toBe("POST");
    expect(importCalls[0]?.headers.get("content-type")).toBe("text/csv");
    expect(importCalls[0]?.body).toBe("name,expectedVersion,status\nTASK-1,1,Closed\n");
    expect(importStdout.text()).toContain("Imported resource CSV at https://app.example");
    expect(importStdout.text()).toContain("DocType: Task Mode: update Total: 2");
    expect(importStdout.text()).toContain("- row 2 update TASK-1");
    expect(importStdout.text()).toContain("- row 3 update TASK-2 failed BAD_REQUEST status 400: Invalid count");
  });

  it("lists, shares, and revokes remote resource document shares through the generated resource API", async () => {
    const listCalls: RemoteCall[] = [];
    const listStdout = textBuffer();
    const listExit = await runCli(
      [
        "resources",
        "shares",
        "--url",
        "https://app.example",
        "--doctype",
        "Task Type",
        "--name",
        "TASK/1",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => tempRoot,
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeFetch(listCalls, {
          data: {
            version: 2,
            grants: [
              { userId: "collab@example.com", permissions: ["read", "update"] },
              { userId: "reviewer@example.com", permissions: ["read"] }
            ]
          }
        }),
        stdout: listStdout,
        stderr: textBuffer()
      }
    );

    expect(listExit).toBe(0);
    expect(listCalls[0]?.url).toBe("https://app.example/api/resource/Task%20Type/TASK%2F1/shares");
    expect(listCalls[0]?.method).toBe("GET");
    expect(listCalls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(listStdout.text()).toContain("Resource shares Task Type/TASK/1 at https://app.example");
    expect(listStdout.text()).toContain("Version: 2 Total: 2");
    expect(listStdout.text()).toContain("- collab@example.com: read, update");

    const shareCalls: RemoteCall[] = [];
    const shareStdout = textBuffer();
    const shareExit = await runCli(
      [
        "resources",
        "share",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--name",
        "TASK-1",
        "--user-id",
        "collab@example.com",
        "--permission",
        "read",
        "--permission",
        "write",
        "--expected-version",
        "2"
      ],
      {
        cwd: () => tempRoot,
        fetch: fakeFetch(shareCalls, {
          data: { name: "TASK-1", version: 3, docstatus: "draft", data: { title: "First" } }
        }, 201),
        stdout: shareStdout,
        stderr: textBuffer()
      }
    );

    expect(shareExit).toBe(0);
    expect(shareCalls[0]?.url).toBe("https://app.example/api/resource/Task/TASK-1/shares");
    expect(shareCalls[0]?.method).toBe("POST");
    expect(shareCalls[0]?.body).toBe(JSON.stringify({
      userId: "collab@example.com",
      permissions: ["read", "write"],
      expectedVersion: 2
    }));
    expect(shareStdout.text()).toContain("Shared resource Task at https://app.example");
    expect(shareStdout.text()).toContain("- TASK-1 version 3 status draft");

    const defaultShareCalls: RemoteCall[] = [];
    const defaultShareExit = await runCli(
      [
        "resources",
        "share",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--name",
        "TASK-1",
        "--user-id",
        "reader@example.com"
      ],
      {
        cwd: () => tempRoot,
        fetch: fakeFetch(defaultShareCalls, {
          data: { name: "TASK-1", version: 4, docstatus: "draft" }
        }, 201),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(defaultShareExit).toBe(0);
    expect(defaultShareCalls[0]?.body).toBe(JSON.stringify({ userId: "reader@example.com" }));

    const unshareCalls: RemoteCall[] = [];
    const unshareStdout = textBuffer();
    const unshareExit = await runCli(
      [
        "resources",
        "unshare",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--name",
        "TASK/1",
        "--user-id",
        "collab@example.com",
        "--expected-version",
        "3"
      ],
      {
        cwd: () => tempRoot,
        fetch: fakeFetch(unshareCalls, {
          data: { name: "TASK/1", version: 4, docstatus: "draft" }
        }),
        stdout: unshareStdout,
        stderr: textBuffer()
      }
    );

    expect(unshareExit).toBe(0);
    expect(unshareCalls[0]?.url).toBe("https://app.example/api/resource/Task/TASK%2F1/shares/collab%40example.com");
    expect(unshareCalls[0]?.method).toBe("DELETE");
    expect(unshareCalls[0]?.body).toBe("{\"expectedVersion\":3}");
    expect(unshareStdout.text()).toContain("Revoked resource share Task at https://app.example");
    expect(unshareStdout.text()).toContain("- TASK/1 version 4 status draft");
  });

  it("lists, saves, and deletes remote saved resource filters through the generated resource API", async () => {
    const listCalls: RemoteCall[] = [];
    const listStdout = textBuffer();
    const listExit = await runCli(
      [
        "resources",
        "saved-filters",
        "--url",
        "https://app.example",
        "--doctype",
        "Task Type",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => tempRoot,
        env: (name) => name === "CF_FRAPPE_AUTH" ? "Bearer test-token" : undefined,
        fetch: fakeFetch(listCalls, {
          data: [
            {
              id: "open",
              label: "Open tasks",
              ownerId: "owner@example.com",
              filters: [{ field: "status", value: "Open" }],
              updatedAt: "2026-06-26T01:00:00.000Z"
            }
          ]
        }),
        stdout: listStdout,
        stderr: textBuffer()
      }
    );

    expect(listExit).toBe(0);
    expect(listCalls[0]?.url).toBe("https://app.example/api/resource/Task%20Type/saved-filters");
    expect(listCalls[0]?.method).toBe("GET");
    expect(listCalls[0]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(listStdout.text()).toContain("Saved resource filters Task Type at https://app.example");
    expect(listStdout.text()).toContain("- open Open tasks owner owner@example.com updated 2026-06-26T01:00:00.000Z");

    const saveCalls: RemoteCall[] = [];
    const saveStdout = textBuffer();
    const saveExit = await runCli(
      [
        "resources",
        "save-filter",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--label",
        "Open important tasks",
        "--filter",
        "status=Open",
        "--filter",
        "priority__in=High",
        "--filter",
        "priority__in=Medium",
        "--filter",
        "count__between=1",
        "--filter",
        "count__between=7",
        "--filter-expression-json",
        "{\"kind\":\"group\",\"match\":\"all\",\"filters\":[{\"field\":\"status\",\"value\":\"Open\"}]}"
      ],
      {
        cwd: () => tempRoot,
        fetch: fakeFetchSequence(saveCalls, [
          {
            body: {
              data: {
                name: "Task",
                fields: [
                  { name: "status" },
                  { name: "priority" },
                  { name: "count" }
                ]
              }
            }
          },
          {
            body: {
              data: {
                id: "filter/1",
                label: "Open important tasks",
                ownerId: "owner@example.com",
                filters: [{ field: "status", value: "Open" }]
              }
            },
            status: 201
          }
        ]),
        stdout: saveStdout,
        stderr: textBuffer()
      }
    );

    expect(saveExit).toBe(0);
    expect(saveCalls[0]?.url).toBe("https://app.example/api/meta/doctypes/Task");
    expect(saveCalls[0]?.method).toBe("GET");
    expect(saveCalls[1]?.url).toBe("https://app.example/api/resource/Task/saved-filters");
    expect(saveCalls[1]?.method).toBe("POST");
    expect(saveCalls[1]?.body).toBe(JSON.stringify({
      label: "Open important tasks",
      filters: [
        { field: "status", value: "Open" },
        { field: "priority", operator: "in", value: ["High", "Medium"] },
        { field: "count", operator: "between", value: ["1", "7"] }
      ],
      filterExpression: { kind: "group", match: "all", filters: [{ field: "status", value: "Open" }] }
    }));
    expect(saveStdout.text()).toContain("Saved resource filter Task at https://app.example");
    expect(saveStdout.text()).toContain("- filter/1 Open important tasks owner owner@example.com");

    const collisionCalls: RemoteCall[] = [];
    const collisionExit = await runCli(
      [
        "resources",
        "save-filter",
        "--url",
        "https://app.example",
        "--doctype",
        "FilterCollision",
        "--label",
        "Collision fields",
        "--filter",
        "count__between=7"
      ],
      {
        cwd: () => tempRoot,
        fetch: fakeFetchSequence(collisionCalls, [
          {
            body: {
              data: {
                name: "FilterCollision",
                fields: [{ name: "count__between" }]
              }
            }
          },
          {
            body: {
              data: {
                id: "collision",
                label: "Collision fields"
              }
            },
            status: 201
          }
        ]),
        stdout: textBuffer(),
        stderr: textBuffer()
      }
    );

    expect(collisionExit).toBe(0);
    expect(collisionCalls[1]?.body).toBe(JSON.stringify({
      label: "Collision fields",
      filters: [{ field: "count__between", value: "7" }]
    }));

    const deleteCalls: RemoteCall[] = [];
    const deleteStdout = textBuffer();
    const deleteExit = await runCli(
      [
        "resources",
        "delete-filter",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--filter-id",
        "filter/1"
      ],
      {
        cwd: () => tempRoot,
        fetch: fakeEmptyFetch(deleteCalls, 204),
        stdout: deleteStdout,
        stderr: textBuffer()
      }
    );

    expect(deleteExit).toBe(0);
    expect(deleteCalls[0]?.url).toBe("https://app.example/api/resource/Task/saved-filters/filter%2F1");
    expect(deleteCalls[0]?.method).toBe("DELETE");
    expect(deleteStdout.text()).toContain("Deleted resource filter Task at https://app.example");
    expect(deleteStdout.text()).toContain("- filter/1");
  });

  it("maps remote resource API errors and missing env headers to CLI failures", async () => {
    const remoteStderr = textBuffer();
    const remoteExit = await runCli(
      ["resources", "get", "--url", "https://app.example", "--doctype", "Task", "--name", "missing"],
      {
        cwd: () => "/workspace",
        fetch: fakeFetch([], {
          error: { code: "NOT_FOUND", message: "Document not found" }
        }, 404),
        stdout: textBuffer(),
        stderr: remoteStderr
      }
    );

    expect(remoteExit).toBe(1);
    expect(remoteStderr.text()).toContain("Remote resource request failed (404): NOT_FOUND: Document not found");

    const envCalls: RemoteCall[] = [];
    const envStderr = textBuffer();
    const envExit = await runCli(
      [
        "resources",
        "list",
        "--url",
        "https://app.example",
        "--doctype",
        "Task",
        "--header-env",
        "Authorization=CF_FRAPPE_AUTH"
      ],
      {
        cwd: () => "/workspace",
        env: () => undefined,
        fetch: fakeFetch(envCalls, {}),
        stdout: textBuffer(),
        stderr: envStderr
      }
    );

    expect(envExit).toBe(1);
    expect(envStderr.text()).toContain("Environment variable 'CF_FRAPPE_AUTH' is not set for header 'Authorization'");
    expect(envCalls).toEqual([]);
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
    const body = init?.body === undefined || init.body === null
      ? undefined
      : await new Response(init.body).text();
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      ...(body === undefined ? {} : { body })
    });
    return new Response(JSON.stringify(responseBody), {
      headers: { "content-type": "application/json" },
      status
    });
  };
}

function fakeFetchSequence(
  calls: RemoteCall[],
  responses: readonly { readonly body: unknown; readonly status?: number }[]
): typeof fetch {
  let index = 0;
  return async (input, init) => {
    const body = init?.body === undefined || init.body === null
      ? undefined
      : await new Response(init.body).text();
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      ...(body === undefined ? {} : { body })
    });
    const response = responses[index] ?? responses[responses.length - 1];
    index += 1;
    return new Response(JSON.stringify(response?.body ?? {}), {
      headers: { "content-type": "application/json" },
      status: response?.status ?? 200
    });
  };
}

function fakeTextFetch(calls: RemoteCall[], responseBody: string, headers: Record<string, string>, status = 200): typeof fetch {
  return async (input, init) => {
    const body = init?.body === undefined || init.body === null
      ? undefined
      : await new Response(init.body).text();
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      ...(body === undefined ? {} : { body })
    });
    return new Response(responseBody, { headers, status });
  };
}

function fakeEmptyFetch(calls: RemoteCall[], status = 204): typeof fetch {
  return async (input, init) => {
    const body = init?.body === undefined || init.body === null
      ? undefined
      : await new Response(init.body).text();
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      ...(body === undefined ? {} : { body })
    });
    return new Response(null, { status });
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
