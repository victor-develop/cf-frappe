import {
  HttpRequestError,
  accountPath,
  assignmentRuleActionPath,
  assignmentRulePath,
  auditDeletedPath,
  calendarMetaPath,
  calendarPath,
  customFieldPath,
  dashboardMetaPath,
  dashboardPath,
  dataPatchPath,
  deskAdminAssignmentRulesPath,
  deskAdminCustomFieldsPath,
  deskAdminFieldPropertiesPath,
  deskAdminUserPermissionsPath,
  deskAdminUsersPath,
  deskAdminWorkflowsPath,
  deskCalendarPath,
  deskDashboardPath,
  deskFilePath,
  deskFilesPath,
  deskKanbanPath,
  deskNotificationsPath,
  deskPrintPath,
  deskPrintPdfPath,
  deskReportBuilderPath,
  deskReportBuilderPdfPath,
  deskReportPath,
  deskReportPdfPath,
  deskSearchPath,
  deskWorkspacePath,
  fieldPropertyPath,
  isJsonBody,
  jobExecutionPath,
  jobSchedulePath,
  kanbanMetaPath,
  kanbanPath,
  linkOptionsPath,
  notificationActionPath,
  notificationRulePath,
  printDocumentPath,
  printFormatPath,
  printLetterheadPath,
  printPdfDocumentPath,
  printSettingsPath,
  profilePath,
  reportBuilderPath,
  reportBuilderPdfPath,
  reportPath,
  reportPdfPath,
  request,
  requestBinary,
  requestInit,
  resourceActionPath,
  resourceMemberPath,
  rolePath,
  roleActionPath,
  rolesPath,
  unwrapData,
  userPermissionPath,
  webFormMetaPath,
  webFormPagePath,
  webFormPath,
  webFormPublicPath,
  webPageMetaPath,
  webPagePath,
  webViewItemPagePath,
  webViewMetaPath,
  webViewPagePath,
  webViewPath,
  websiteThemeMetaPath
} from "../../src/adapters/desk/client-src/http";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("client-src fetch machinery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects JSON bodies", () => {
    expect(isJsonBody({ a: 1 })).toBe(true);
    expect(isJsonBody(undefined)).toBe(false);
    expect(isJsonBody("text")).toBe(false);
    expect(isJsonBody(new FormData())).toBe(false);
    expect(isJsonBody(new URLSearchParams())).toBe(false);
    expect(isJsonBody(new Blob(["x"]))).toBe(false);
  });

  it("unwraps data envelopes", () => {
    expect(unwrapData({ data: { a: 1 } })).toEqual({ a: 1 });
    expect(unwrapData({ b: 2 })).toEqual({ b: 2 });
    expect(unwrapData(undefined)).toBeUndefined();
  });

  it("requestInit serializes JSON bodies and defaults credentials", () => {
    const init = requestInit({ method: "POST", body: { a: 1 } });
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Headers).get("content-type")).toBe("application/json");
  });

  it("requestInit leaves string / form bodies alone and keeps overrides", () => {
    const form = new URLSearchParams("a=1");
    const init = requestInit({ body: form, credentials: "include", headers: { "x-a": "1" } });
    expect(init.body).toBe(form);
    expect(init.credentials).toBe("include");
    expect((init.headers as Headers).get("x-a")).toBe("1");
    expect((init.headers as Headers).has("content-type")).toBe(false);
    expect(requestInit().credentials).toBe("same-origin");
    expect(requestInit({ body: "raw" }).body).toBe("raw");
  });

  it("request resolves JSON payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(request("/api/x")).resolves.toEqual({ data: { ok: true } });
    expect(fetchMock).toHaveBeenCalledWith("/api/x", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("request resolves text payloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<p>hi</p>", { status: 200 })));
    await expect(request("/api/x")).resolves.toBe("<p>hi</p>");
  });

  it("request throws HttpRequestError with server error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { message: "nope" } }, 409))
    );
    const error = (await request("/api/x").catch((cause: unknown) => cause)) as HttpRequestError;
    expect(error).toBeInstanceOf(HttpRequestError);
    expect(error.message).toBe("nope");
    expect(error.status).toBe(409);
    expect(error.payload).toEqual({ error: { message: "nope" } });
  });

  it("request falls back to statusText without a payload message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 500, statusText: "Internal Server Error" }))
    );
    await expect(request("/api/x")).rejects.toThrow("Internal Server Error");
  });

  it("requestBinary returns array buffers and throws on errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 })));
    const buffer = await requestBinary("/api/pdf");
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3]));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { message: "denied" } }, 403)));
    await expect(requestBinary("/api/pdf")).rejects.toThrow("denied");
  });
});

describe("client-src desk page paths", () => {
  it("builds desk view urls", () => {
    expect(deskDashboardPath("D 1")).toBe("/desk/dashboards/D%201");
    expect(deskKanbanPath("K")).toBe("/desk/kanbans/K");
    expect(deskCalendarPath("C", { from: "a", to: "b" })).toBe("/desk/calendars/C?from=a&to=b");
    expect(deskCalendarPath("C")).toBe("/desk/calendars/C");
    expect(deskWorkspacePath("W")).toBe("/desk/workspaces/W");
  });

  it("builds web form/view/page urls", () => {
    expect(webFormPublicPath("contact")).toBe("contact");
    expect(webFormPublicPath({ route: "a/b c" })).toBe("a/b%20c");
    expect(webFormPublicPath({ route: "  " , name: "n" })).toBe("n");
    expect(webFormPublicPath({ form: { name: "n" } })).toBe("n");
    expect(webFormPublicPath({ form: { route: "r" } })).toBe("r");
    expect(webFormPagePath("contact")).toBe("/web-forms/contact");
    expect(webViewPagePath("v")).toBe("/web/v");
    expect(webViewItemPagePath("v", "a/b")).toBe("/web/v/a/b");
    expect(webPagePath("about us")).toBe("/page/about%20us");
  });

  it("builds desk admin urls with user aliases", () => {
    expect(deskAdminUsersPath({ userId: "u1" })).toBe("/desk/admin/users?user=u1");
    expect(deskAdminUsersPath({ user: "u2" })).toBe("/desk/admin/users?user=u2");
    expect(deskAdminUsersPath()).toBe("/desk/admin/users");
    expect(deskAdminCustomFieldsPath("Task")).toBe("/desk/admin/custom-fields?doctype=Task");
    expect(deskAdminCustomFieldsPath()).toBe("/desk/admin/custom-fields");
    expect(deskAdminFieldPropertiesPath("Task", "status")).toBe("/desk/admin/field-properties?doctype=Task&field=status");
    expect(deskAdminUserPermissionsPath({ userId: "u" })).toBe("/desk/admin/user-permissions?user=u");
    expect(deskAdminUserPermissionsPath({ user: "v" })).toBe("/desk/admin/user-permissions?user=v");
    expect(deskAdminWorkflowsPath("Task")).toBe("/desk/admin/workflows?doctype=Task");
    expect(deskAdminAssignmentRulesPath("Task", "r")).toBe("/desk/admin/assignment-rules?doctype=Task&rule=r");
  });

  it("builds desk files/notifications/search/print/report urls", () => {
    expect(deskFilesPath({ filename: "a.txt" })).toBe("/desk/files?filename=a.txt");
    expect(deskFilePath("f", "content")).toBe("/desk/files/f/content");
    expect(deskFilePath("f")).toBe("/desk/files/f");
    expect(deskNotificationsPath({ limit: 5 })).toBe("/desk/notifications?limit=5");
    expect(deskSearchPath("term", { limit: 2 })).toBe("/desk/search?q=term&limit=2");
    expect(deskPrintPath("Standard", "T1")).toBe("/desk/print/Standard/T1");
    expect(deskPrintPdfPath("Standard", "T1")).toBe("/desk/print/Standard/T1/pdf");
    expect(deskReportBuilderPath("Task")).toBe("/desk/report-builder/Task");
    expect(deskReportBuilderPath("Task", "r1", { limit: 1 })).toBe("/desk/report-builder/Task/r1?limit=1");
    expect(deskReportBuilderPdfPath("Task", "r1")).toBe("/desk/report-builder/Task/r1/pdf");
    expect(deskReportPath("R", { limit: 2 })).toBe("/desk/reports/R?limit=2");
    expect(deskReportPdfPath("R")).toBe("/desk/reports/R/pdf");
  });
});

describe("client-src api paths", () => {
  it("builds resource paths", () => {
    expect(resourceActionPath("Task", "T1", "comments")).toBe("/api/resource/Task/T1/comments");
    expect(resourceMemberPath("Task", "T1", "tags", "a b")).toBe("/api/resource/Task/T1/tags/a%20b");
  });

  it("builds account/profile/notification paths", () => {
    expect(profilePath("u", { tenant: "t" })).toBe("/api/users/u/profile?tenant=t");
    expect(accountPath("u")).toBe("/api/users/u");
    expect(accountPath("u", "disable", { tenant: "t" })).toBe("/api/users/u/disable?tenant=t");
    expect(notificationActionPath("n1", "read", { user: "u" })).toBe("/api/notifications/n1/read?user=u");
  });

  it("builds rule/role/meta-config paths", () => {
    expect(notificationRulePath("Task")).toBe("/api/notification-rules/Task");
    expect(notificationRulePath("Task", "r", { tenant: "t" })).toBe("/api/notification-rules/Task/r?tenant=t");
    expect(assignmentRulePath("Task")).toBe("/api/assignment-rules/Task");
    expect(assignmentRulePath("Task", "r")).toBe("/api/assignment-rules/Task/r");
    expect(assignmentRuleActionPath("Task", "r", "enable")).toBe("/api/assignment-rules/Task/r/enable");
    expect(rolesPath({ tenant: "t" })).toBe("/api/roles?tenant=t");
    expect(rolePath("admin")).toBe("/api/roles/admin");
    expect(roleActionPath("admin", "disable")).toBe("/api/roles/admin/disable");
    expect(customFieldPath("Task")).toBe("/api/custom-fields/Task");
    expect(customFieldPath("Task", "f")).toBe("/api/custom-fields/Task/f");
    expect(fieldPropertyPath("Task")).toBe("/api/field-properties/Task");
    expect(fieldPropertyPath("Task", "f")).toBe("/api/field-properties/Task/f");
    expect(workflowPathCheck()).toBe(true);
    expect(userPermissionPath("u", { tenant: "t" })).toBe("/api/user-permissions/u?tenant=t");
  });

  it("builds data patch and meta view paths", () => {
    expect(dataPatchPath()).toBe("/api/data-patches");
    expect(dataPatchPath("p1")).toBe("/api/data-patches/p1");
    expect(dataPatchPath("p1", "apply")).toBe("/api/data-patches/p1/apply");
    expect(dataPatchPath(undefined, "plan")).toBe("/api/data-patches/plan");
    expect(dashboardPath()).toBe("/api/meta/dashboards");
    expect(dashboardPath("d", "run")).toBe("/api/dashboard/d/run");
    expect(dashboardMetaPath("d")).toBe("/api/meta/dashboards/d");
    expect(dashboardMetaPath()).toBe("/api/meta/dashboards");
    expect(kanbanPath("k", "run")).toBe("/api/kanban/k/run");
    expect(kanbanPath()).toBe("/api/meta/kanbans");
    expect(kanbanMetaPath("k")).toBe("/api/meta/kanbans/k");
    expect(kanbanMetaPath()).toBe("/api/meta/kanbans");
    expect(calendarPath("c", "run", { limit: 1 })).toBe("/api/calendar/c/run?limit=1");
    expect(calendarPath()).toBe("/api/meta/calendars");
    expect(calendarMetaPath("c")).toBe("/api/meta/calendars/c");
    expect(calendarMetaPath()).toBe("/api/meta/calendars");
    expect(webFormPath("w", "submit")).toBe("/api/web-form/w/submit");
    expect(webFormPath()).toBe("/api/meta/web-forms");
    expect(webFormMetaPath("w")).toBe("/api/meta/web-forms/w");
    expect(webFormMetaPath()).toBe("/api/meta/web-forms");
    expect(webViewMetaPath("v")).toBe("/api/meta/web-views/v");
    expect(webViewMetaPath()).toBe("/api/meta/web-views");
    expect(webViewPath("v")).toBe("/api/web-view/v");
    expect(webViewPath("v", "a/b", { limit: 1, offset: 2 })).toBe("/api/web-view/v/a/b?limit=1&offset=2");
    expect(webPageMetaPath("p")).toBe("/api/meta/web-pages/p");
    expect(webPageMetaPath()).toBe("/api/meta/web-pages");
    expect(websiteThemeMetaPath("t")).toBe("/api/meta/website-themes/t");
    expect(websiteThemeMetaPath()).toBe("/api/meta/website-themes");
  });

  it("builds report/audit/link/print/job paths", () => {
    expect(reportBuilderPath("Task")).toBe("/api/report-builder/Task");
    expect(reportBuilderPath("Task", "r", "run")).toBe("/api/report-builder/Task/r/run");
    expect(reportPath("R")).toBe("/api/report/R");
    expect(reportPath("R", "run")).toBe("/api/report/R/run");
    expect(reportPdfPath("R", { limit: 1 })).toBe("/api/report/R/pdf?limit=1");
    expect(reportPdfPath("R")).toBe("/api/report/R/pdf");
    expect(reportBuilderPdfPath("Task", "r")).toBe("/api/report-builder/Task/r/pdf");
    expect(auditDeletedPath("Task", "T1", { tenant: "t" })).toBe("/api/audit/deleted/Task/T1?tenant=t");
    expect(linkOptionsPath("Task", "owner", { q: "a" })).toBe("/api/link-options/Task/owner?q=a");
    expect(linkOptionsPath("Task", "owner")).toBe("/api/link-options/Task/owner");
    expect(printDocumentPath("F", "N")).toBe("/api/print/F/N");
    expect(printPdfDocumentPath("F", "N")).toBe("/api/print/F/N/pdf");
    expect(printFormatPath("F")).toBe("/api/meta/print-formats/F");
    expect(printFormatPath()).toBe("/api/meta/print-formats");
    expect(printLetterheadPath("L")).toBe("/api/meta/print-letterheads/L");
    expect(printLetterheadPath()).toBe("/api/meta/print-letterheads");
    expect(printSettingsPath({ tenant: "t" })).toBe("/api/print-settings?tenant=t");
    expect(printSettingsPath()).toBe("/api/print-settings");
    expect(jobExecutionPath("k")).toBe("/api/jobs/executions/k");
    expect(jobExecutionPath("k", "retry")).toBe("/api/jobs/executions/k/retry");
    expect(jobSchedulePath()).toBe("/api/jobs/schedules");
    expect(jobSchedulePath("s")).toBe("/api/jobs/schedules/s");
    expect(jobSchedulePath("s", "pause")).toBe("/api/jobs/schedules/s/pause");
  });
});

import { workflowPath } from "../../src/adapters/desk/client-src/http";

function workflowPathCheck(): boolean {
  return (
    workflowPath("Task") === "/api/workflows/Task" &&
    workflowPath("Task", "w", { tenant: "t" }) === "/api/workflows/Task/w?tenant=t"
  );
}
