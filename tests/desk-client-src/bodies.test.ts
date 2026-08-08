import {
  appendFilterParams,
  assignmentRuleBody,
  assignmentRuleEntry,
  auditEventParams,
  bulkDocumentsBody,
  bulkFilesBody,
  calendarParams,
  commandBody,
  commentBody,
  currentDeskListReturnTo,
  customFieldBody,
  dataPatchBody,
  descriptionBody,
  deskBulkDocumentsBody,
  deskImportBody,
  deskNotificationInboxParams,
  fieldPropertyBody,
  fileAttachmentParams,
  fileListParams,
  fileTransformParams,
  jobDashboardParams,
  jobScheduleParams,
  notificationCommandParams,
  notificationInboxParams,
  notificationRuleBody,
  notificationRuleEntry,
  notificationRuleToggleBody,
  passwordBody,
  printFormatParams,
  reportExportParams,
  reportRunParams,
  resourceExportParams,
  resourceListParams,
  rolesBody,
  savedFilterBody,
  searchParams,
  tenantParams,
  timelineParams,
  userPermissionBody,
  versionBody,
  webViewParams,
  withoutKeys,
  workflowBody,
  type RuleState
} from "../../src/adapters/desk/client-src/bodies";
import type { MutableQueryParams } from "../../src/adapters/desk/client-src/url";

describe("client-src body builders", () => {
  it("versionBody includes expectedVersion only when provided", () => {
    expect(versionBody({ expectedVersion: 3 })).toEqual({ expectedVersion: 3 });
    expect(versionBody({})).toEqual({});
    expect(versionBody()).toEqual({});
  });

  it("withoutKeys drops excluded keys", () => {
    expect(withoutKeys({ a: 1, b: 2 }, ["b"])).toEqual({ a: 1 });
    expect(withoutKeys(undefined, ["b"])).toEqual({});
  });

  it("commandBody strips expectedVersion from the input and re-applies from options", () => {
    expect(commandBody({ a: 1, expectedVersion: 9 }, { expectedVersion: 4 })).toEqual({ a: 1, expectedVersion: 4 });
    expect(commandBody({ a: 1 })).toEqual({ a: 1 });
  });

  it("wraps scalar comment/description/password inputs", () => {
    expect(commentBody("hi", { expectedVersion: 1 })).toEqual({ text: "hi", expectedVersion: 1 });
    expect(commentBody({ text: "t" })).toEqual({ text: "t" });
    expect(descriptionBody("d")).toEqual({ description: "d" });
    expect(descriptionBody({ description: "e" })).toEqual({ description: "e" });
    expect(passwordBody("p")).toEqual({ password: "p" });
    expect(passwordBody({ password: "q" })).toEqual({ password: "q" });
  });

  it("rolesBody wraps arrays", () => {
    expect(rolesBody(["a", "b"])).toEqual({ roles: ["a", "b"] });
    expect(rolesBody({ roles: ["c"] })).toEqual({ roles: ["c"] });
  });

  it("customFieldBody strips expectedVersion from plain-object fields", () => {
    expect(customFieldBody({ fieldname: "x", expectedVersion: 2 }, { expectedVersion: 5 })).toEqual({
      field: { fieldname: "x" },
      expectedVersion: 5
    });
    expect(customFieldBody("raw")).toEqual({ field: "raw" });
  });

  it("notification/assignment rule bodies strip name and expectedVersion", () => {
    expect(notificationRuleBody({ name: "r", events: [], expectedVersion: 1 })).toEqual({ rule: { events: [] } });
    expect(notificationRuleBody("raw")).toEqual({ rule: "raw" });
    expect(assignmentRuleBody({ name: "r", assign: [] }, { expectedVersion: 2 })).toEqual({
      rule: { assign: [] },
      expectedVersion: 2
    });
    expect(assignmentRuleBody("raw")).toEqual({ rule: "raw" });
  });

  describe("notificationRuleToggleBody", () => {
    const state: RuleState = {
      version: 7,
      rules: [
        undefined,
        { rule: { name: "other", events: ["a"], recipients: ["r"] } },
        {
          rule: {
            name: "full",
            events: ["created"],
            recipients: ["owner"],
            channels: ["email"],
            condition: "doc.x == 1",
            subject: "s",
            excludeActor: true
          }
        },
        { rule: { name: "minimal", events: ["created"], recipients: ["owner"], channels: [] } },
        { rule: { name: "no-events", recipients: ["owner"] } },
        { rule: { name: "no-recipients", events: ["created"] } }
      ]
    };

    it("copies optional rule attributes when present", () => {
      expect(notificationRuleToggleBody("full", state, false)).toEqual({
        rule: {
          events: ["created"],
          recipients: ["owner"],
          channels: ["email"],
          condition: "doc.x == 1",
          enabled: false,
          subject: "s",
          excludeActor: true
        },
        expectedVersion: 7
      });
    });

    it("omits optional attributes when absent and falls back to state version", () => {
      expect(notificationRuleToggleBody("minimal", state, true)).toEqual({
        rule: { events: ["created"], recipients: ["owner"], enabled: true },
        expectedVersion: 7
      });
    });

    it("prefers the explicit expectedVersion when it matches", () => {
      expect(notificationRuleToggleBody("minimal", state, true, { expectedVersion: 7 }).expectedVersion).toBe(7);
    });

    it("defaults expectedVersion to 0 without state version", () => {
      const versionless: RuleState = { rules: [{ rule: { name: "m", events: ["e"], recipients: ["r"] } }] };
      expect(notificationRuleToggleBody("m", versionless, true).expectedVersion).toBe(0);
    });

    it("rejects version mismatches", () => {
      expect(() => notificationRuleToggleBody("minimal", state, true, { expectedVersion: 3 })).toThrow(
        "Expected notification rules at version 3, found 7"
      );
    });

    it("rejects rules without events or recipients", () => {
      expect(() => notificationRuleToggleBody("no-events", state, true)).toThrow("has no events");
      expect(() => notificationRuleToggleBody("no-recipients", state, true)).toThrow("has no recipients");
    });

    it("rejects unknown rules", () => {
      expect(() => notificationRuleToggleBody("missing", state, true)).toThrow(
        "Notification rule 'missing' was not found in remote state"
      );
    });
  });

  it("finds rule entries by name", () => {
    const state: RuleState = { rules: [{ rule: { name: "a" } }] };
    expect(notificationRuleEntry("a", state)).toEqual({ rule: { name: "a" } });
    expect(assignmentRuleEntry("a", state)).toEqual({ rule: { name: "a" } });
    expect(() => assignmentRuleEntry("b", state)).toThrow("Assignment rule 'b' was not found in remote state");
    expect(() => notificationRuleEntry("b", undefined)).toThrow("was not found in remote state");
  });

  it("fieldPropertyBody and workflowBody strip expectedVersion from plain objects", () => {
    expect(fieldPropertyBody({ hidden: 1, expectedVersion: 3 }, { expectedVersion: 3 })).toEqual({
      overrides: { hidden: 1 },
      expectedVersion: 3
    });
    expect(fieldPropertyBody("raw")).toEqual({ overrides: "raw" });
    expect(workflowBody({ name: "w", expectedVersion: 1 })).toEqual({ workflow: { name: "w" } });
    expect(workflowBody("raw")).toEqual({ workflow: "raw" });
  });

  it("userPermissionBody defaults to an empty grant", () => {
    expect(userPermissionBody(undefined, { expectedVersion: 2 })).toEqual({ expectedVersion: 2 });
    expect(userPermissionBody({ doctype: "Task" })).toEqual({ doctype: "Task" });
  });

  it("dataPatchBody optionally drops patchIds", () => {
    expect(dataPatchBody({ patchIds: ["a"], dryRun: true })).toEqual({ patchIds: ["a"], dryRun: true });
    expect(dataPatchBody({ patchIds: ["a"], dryRun: true }, false)).toEqual({ dryRun: true });
    expect(dataPatchBody(undefined)).toEqual({});
  });

  it("savedFilterBody drops the id", () => {
    expect(savedFilterBody({ id: "x", label: "L" })).toEqual({ label: "L" });
  });

  it("bulk bodies wrap their payloads", () => {
    expect(bulkDocumentsBody(["a"])).toEqual({ documents: ["a"] });
    expect(bulkFilesBody(["f"], { reason: "r" })).toEqual({ files: ["f"], reason: "r" });
    expect(bulkFilesBody(["f"])).toEqual({ files: ["f"] });
  });
});

describe("client-src param builders", () => {
  it("tenantParams", () => {
    expect(tenantParams({ tenant: "t1" })).toEqual({ tenant: "t1" });
    expect(tenantParams({})).toEqual({});
    expect(tenantParams()).toEqual({});
  });

  it("notification inbox params support camel and snake case", () => {
    expect(notificationInboxParams({ user: "u", limit: 5, unread: true, includeDismissed: false })).toEqual({
      user: "u",
      limit: 5,
      unread: true,
      include_dismissed: false
    });
    expect(notificationInboxParams({ include_dismissed: true })).toEqual({ include_dismissed: true });
    expect(notificationInboxParams()).toEqual({});
  });

  it("notificationCommandParams", () => {
    expect(notificationCommandParams({ user: "u" })).toEqual({ user: "u" });
    expect(notificationCommandParams()).toEqual({});
  });

  it("deskNotificationInboxParams", () => {
    expect(deskNotificationInboxParams({ limit: 1, unread: true, includeDismissed: true })).toEqual({
      limit: 1,
      unread: true,
      include_dismissed: true
    });
    expect(deskNotificationInboxParams({ include_dismissed: false })).toEqual({ include_dismissed: false });
  });

  it("fileAttachmentParams prefers the attachedTo object", () => {
    const params: MutableQueryParams = {};
    fileAttachmentParams(params, { attachedTo: { doctype: "Task", name: "T1" } });
    expect(params).toEqual({ attached_to_doctype: "Task", attached_to_name: "T1" });
  });

  it("fileAttachmentParams falls back to snake keys", () => {
    const params: MutableQueryParams = {};
    fileAttachmentParams(params, { attached_to_doctype: "Task", attached_to_name: "T1" });
    expect(params).toEqual({ attached_to_doctype: "Task", attached_to_name: "T1" });
    const none: MutableQueryParams = {};
    fileAttachmentParams(none, {});
    expect(none).toEqual({});
    fileAttachmentParams(none);
    expect(none).toEqual({});
  });

  it("fileListParams merges attachment, camel and snake options", () => {
    expect(
      fileListParams({
        attachedTo: { doctype: "Task", name: "T1" },
        contentType: "image/png",
        filename: "a.png",
        isPrivate: true,
        limit: 10,
        scanStatus: "clean",
        storageState: "stored",
        uploadedBy: "u"
      })
    ).toEqual({
      attached_to_doctype: "Task",
      attached_to_name: "T1",
      content_type: "image/png",
      filename: "a.png",
      is_private: true,
      limit: 10,
      scan_status: "clean",
      storage_state: "stored",
      uploaded_by: "u"
    });
    expect(
      fileListParams({ content_type: "a", is_private: false, scan_status: "s", storage_state: "st", uploaded_by: "u" })
    ).toEqual({ content_type: "a", is_private: false, scan_status: "s", storage_state: "st", uploaded_by: "u" });
  });

  it("fileTransformParams handles scalar and object watermark/overlay inputs", () => {
    expect(fileTransformParams({ width: 10, watermark: "draft", overlay: "logo.png" })).toEqual({
      width: 10,
      watermark: "draft",
      overlay: "logo.png"
    });
    expect(
      fileTransformParams({
        height: 20,
        fit: "cover",
        format: "webp",
        quality: 80,
        watermark: { text: "wm", placement: "center", opacity: 0.5, color: "#fff", fontSize: 12 },
        overlay: { file: "o.png", placement: "top", opacity: 0.4, width: 5, height: 6 }
      })
    ).toEqual({
      height: 20,
      fit: "cover",
      format: "webp",
      quality: 80,
      watermark: "wm",
      watermarkPlacement: "center",
      watermarkOpacity: 0.5,
      watermarkColor: "#fff",
      watermarkFontSize: 12,
      overlay: "o.png",
      overlayPlacement: "top",
      overlayOpacity: 0.4,
      overlayWidth: 5,
      overlayHeight: 6
    });
    expect(fileTransformParams({})).toEqual({});
  });

  it("auditEventParams supports camel and snake actor ids", () => {
    expect(
      auditEventParams({ tenant: "t", doctype: "Task", name: "T1", actorId: "u", kind: "k", since: 1, until: 2, limit: 3 })
    ).toEqual({ tenant: "t", doctype: "Task", name: "T1", actor_id: "u", kind: "k", since: 1, until: 2, limit: 3 });
    expect(auditEventParams({ actor_id: "v" })).toEqual({ actor_id: "v" });
  });

  it("printFormatParams", () => {
    expect(printFormatParams({ doctype: "Task" })).toEqual({ doctype: "Task" });
    expect(printFormatParams()).toEqual({});
  });

  it("appendFilterParams supports operators, scalars and empty markers", () => {
    const params: MutableQueryParams = {};
    appendFilterParams(params, "skip", undefined);
    appendFilterParams(params, "skip", null);
    appendFilterParams(params, "status", "Open");
    appendFilterParams(params, "age", { gt: 3, eq: 4, skip: null });
    appendFilterParams(params, "empty", "");
    appendFilterParams(params, "list", ["a", ""]);
    expect(params).toEqual({
      filter_status: "Open",
      filter_age__gt: 3,
      filter_age: 4,
      filter_empty: "",
      filter_list: ["a", ""],
      empty_filter: ["filter_empty", "filter_list"]
    });
  });

  it("resourceListParams copies passthrough keys and normalizes filters/order", () => {
    expect(
      resourceListParams({
        limit: 5,
        offset: 10,
        skipMe: undefined,
        skipNull: null,
        orderBy: "modified",
        order: "desc",
        filterExpression: { and: [] },
        filters: { status: "Open", amount: { gte: 3 } }
      })
    ).toEqual({
      limit: 5,
      offset: 10,
      order_by: "modified",
      order: "desc",
      filter_expression: JSON.stringify({ and: [] }),
      filter_status: "Open",
      filter_amount__gte: 3
    });
    expect(resourceListParams({ order_by: "name", filter_expression: "raw" })).toEqual({
      order_by: "name",
      filter_expression: "raw"
    });
    expect(resourceListParams()).toEqual({});
  });

  it("resourceExportParams drops the offset", () => {
    expect(resourceExportParams({ limit: 5, offset: 10 })).toEqual({ limit: 5 });
  });

  it("reportRunParams collects filters, expression, order and paging", () => {
    expect(
      reportRunParams({
        filters: { status: "Open" },
        filterExpression: "expr",
        orderBy: "modified",
        order: "asc",
        limit: 20,
        offset: 40
      })
    ).toEqual({
      filter_status: "Open",
      filter_expression: "expr",
      order_by: "modified",
      order: "asc",
      limit: 20,
      offset: 40
    });
    expect(reportRunParams({ filter_expression: "", order_by: "x" })).toEqual({ order_by: "x" });
    expect(reportRunParams()).toEqual({});
  });

  it("reportExportParams drops the offset", () => {
    expect(reportExportParams({ limit: 1, offset: 2 })).toEqual({ limit: 1 });
  });

  it("calendarParams / webViewParams / searchParams", () => {
    expect(calendarParams({ from: "2026-01-01", to: "2026-02-01", limit: 9 })).toEqual({
      from: "2026-01-01",
      to: "2026-02-01",
      limit: 9
    });
    expect(calendarParams()).toEqual({});
    expect(webViewParams({ limit: 1, offset: 2 })).toEqual({ limit: 1, offset: 2 });
    expect(webViewParams()).toEqual({});
    expect(searchParams("q", { limit: 5, tenant: "t" })).toEqual({ q: "q", limit: 5, tenant: "t" });
    expect(searchParams(undefined)).toEqual({});
  });

  it("job params support camel and snake keys", () => {
    expect(jobDashboardParams({ jobName: "j", runId: "r", status: "ok", limit: 2 })).toEqual({
      job: "j",
      run_id: "r",
      status: "ok",
      limit: 2
    });
    expect(jobDashboardParams({ job: "j2", run_id: "r2" })).toEqual({ job: "j2", run_id: "r2" });
    expect(jobScheduleParams({ cron: "* * * * *", jobName: "j" })).toEqual({ cron: "* * * * *", job: "j" });
    expect(jobScheduleParams({ job: "j2" })).toEqual({ job: "j2" });
    expect(jobScheduleParams()).toEqual({});
  });

  it("timelineParams supports camel and snake sequencing", () => {
    expect(timelineParams({ limit: 5, beforeSequence: 9 })).toEqual({ limit: 5, before_sequence: 9 });
    expect(timelineParams({ before_sequence: 3 })).toEqual({ before_sequence: 3 });
    expect(timelineParams({})).toEqual({});
    expect(timelineParams()).toEqual({});
  });
});

describe("client-src desk form-encoded bodies", () => {
  it("currentDeskListReturnTo returns undefined off the list page", () => {
    expect(currentDeskListReturnTo("Task")).toBeUndefined();
  });

  it("currentDeskListReturnTo echoes the list path when on it", () => {
    const happyDom = (window as unknown as { happyDOM?: { setURL: (url: string) => void } }).happyDOM;
    happyDom?.setURL("http://localhost:8000/desk/Task?limit=5");
    try {
      expect(currentDeskListReturnTo("Task")).toBe("/desk/Task?limit=5");
    } finally {
      happyDom?.setURL("about:blank");
    }
  });

  it("deskImportBody carries mode, returnTo and csv", () => {
    const body = deskImportBody("Task", "a,b", { mode: "insert", returnTo: "/desk/Task" });
    expect(body.get("mode")).toBe("insert");
    expect(body.get("returnTo")).toBe("/desk/Task");
    expect(body.get("csv")).toBe("a,b");
  });

  it("deskImportBody defaults csv to empty and omits absent params", () => {
    const body = deskImportBody("Task", undefined, {});
    expect(body.get("csv")).toBe("");
    expect(body.has("mode")).toBe(false);
    expect(body.has("returnTo")).toBe(false);
  });

  it("deskBulkDocumentsBody serializes names and per-document versions", () => {
    const body = deskBulkDocumentsBody(
      "Task",
      ["T1", { name: "T2", expectedVersion: 4 }, { expectedVersion: 9 }, { name: null as unknown as string }],
      { returnTo: "/desk/Task" }
    );
    expect(body.get("returnTo")).toBe("/desk/Task");
    expect(body.getAll("document")).toEqual(["T1", "T2"]);
    expect(body.has("expectedVersion:T1")).toBe(false);
    expect(body.get("expectedVersion:T2")).toBe("4");
  });

  it("deskBulkDocumentsBody tolerates missing documents", () => {
    const body = deskBulkDocumentsBody("Task", undefined, {});
    expect(body.getAll("document")).toEqual([]);
  });
});
