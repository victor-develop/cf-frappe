import { CHILD_TABLE_ROW_INDEX_FIELD } from "../../core/types.js";
import { MAX_MULTIPART_FILE_PARTS, MIN_MULTIPART_FILE_PART_BYTES } from "../../ports/file-storage.js";

export const DESK_CLIENT_SCRIPT_PATH = "/desk/client.js";

export function renderDeskClientScript(): string {
  return `(function () {
  "use strict";

  var root = window;
  var childRowIndexField = ${JSON.stringify(CHILD_TABLE_ROW_INDEX_FIELD)};
  var lockedValueProperty = "__cfFrappeLockedValue";
  var readOnlyProperty = "__cfFrappeReadOnly";
  var softDisabledProperty = "__cfFrappeSoftDisabled";
  var realtimeCollaborationMessageType = "cf-frappe.realtime.collaboration";
  var fieldEditMessageType = "cf-frappe.collaboration.field_edit";
  var sharedDraftMessageType = "cf-frappe.collaboration.shared_draft";

  function encodePart(value) {
    return encodeURIComponent(String(value));
  }

  function isJsonBody(value) {
    return (
      value !== undefined &&
      typeof value !== "string" &&
      !(value instanceof FormData) &&
      !(value instanceof URLSearchParams) &&
      !(value instanceof Blob)
    );
  }

  function withQuery(path, params) {
    var query = new URLSearchParams();
    Object.entries(params || {}).forEach(function (entry) {
      var value = entry[1];
      if (Array.isArray(value)) {
        value.forEach(function (item) {
          if (item !== undefined && item !== null) {
            query.append(entry[0], String(item));
          }
        });
      } else if (value !== undefined && value !== null) {
        query.set(entry[0], String(value));
      }
    });
    var suffix = query.toString();
    return suffix ? path + "?" + suffix : path;
  }

  function unwrapData(payload) {
    return payload && Object.prototype.hasOwnProperty.call(payload, "data") ? payload.data : payload;
  }

  function resourceListParams(options) {
    var params = {};
    Object.entries(options || {}).forEach(function (entry) {
      var key = entry[0];
      var value = entry[1];
      if (
        key !== "filters" &&
        key !== "filterExpression" &&
        key !== "filter_expression" &&
        key !== "orderBy" &&
        key !== "order_by" &&
        value !== undefined &&
        value !== null
      ) {
        params[key] = value;
      }
    });
    setParam(params, "order_by", options && (options.orderBy !== undefined ? options.orderBy : options.order_by));
    setParam(params, "order", options && options.order);
    setFilterExpressionParam(
      params,
      options && (options.filterExpression !== undefined ? options.filterExpression : options.filter_expression)
    );
    Object.entries((options && options.filters) || {}).forEach(function (entry) {
      appendFilterParams(params, entry[0], entry[1]);
    });
    return params;
  }

  function resourceExportParams(options) {
    var params = resourceListParams(options || {});
    delete params.offset;
    return params;
  }

  function appendFilterParams(params, field, value) {
    if (value === undefined || value === null) {
      return;
    }
    if (isPlainObject(value)) {
      Object.entries(value).forEach(function (entry) {
        if (entry[1] !== undefined && entry[1] !== null) {
          setFilterParam(params, "filter_" + field + (entry[0] === "eq" ? "" : "__" + entry[0]), entry[1]);
        }
      });
      return;
    }
    setFilterParam(params, "filter_" + field, value);
  }

  function setFilterParam(params, key, value) {
    params[key] = value;
    if (value === "" || (Array.isArray(value) && value.some(function (item) { return item === ""; }))) {
      appendParam(params, "empty_filter", key);
    }
  }

  function setFilterExpressionParam(params, value) {
    if (value === undefined || value === null || value === "") {
      return;
    }
    params.filter_expression = typeof value === "string" ? value : JSON.stringify(value);
  }

  function appendParam(params, key, value) {
    var current = params[key];
    if (current === undefined) {
      params[key] = value;
    } else if (Array.isArray(current)) {
      current.push(value);
    } else {
      params[key] = [current, value];
    }
  }

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
  }

  function requestInit(options) {
    var init = options || {};
    var headers = new Headers(init.headers || {});
    var body = init.body;
    if (isJsonBody(body)) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(body);
    }
    return Object.assign({}, init, {
      body: body,
      credentials: init.credentials || "same-origin",
      headers: headers
    });
  }

  async function readResponsePayload(response) {
    var contentType = response.headers.get("content-type") || "";
    return contentType.indexOf("application/json") >= 0 ? await response.json() : await response.text();
  }

  function throwResponseError(response, payload) {
    var error = new Error((payload && payload.error && payload.error.message) || response.statusText);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  async function request(path, options) {
    var response = await fetch(path, requestInit(options));
    var payload = await readResponsePayload(response);
    if (!response.ok) {
      throwResponseError(response, payload);
    }
    return payload;
  }

  async function requestBinary(path, options) {
    var response = await fetch(path, requestInit(options));
    if (!response.ok) {
      throwResponseError(response, await readResponsePayload(response));
    }
    return response.arrayBuffer();
  }

  function resourcePath(doctype, name) {
    return "/api/resource/" + encodePart(doctype) + (name === undefined ? "" : "/" + encodePart(name));
  }

  function deskPath(doctype) {
    return "/desk/" + encodePart(doctype);
  }

  function deskDashboardPath(dashboard) {
    return "/desk/dashboards/" + encodePart(dashboard);
  }

  function deskKanbanPath(kanban) {
    return "/desk/kanbans/" + encodePart(kanban);
  }

  function deskCalendarPath(calendar, options) {
    return withQuery("/desk/calendars/" + encodePart(calendar), calendarParams(options || {}));
  }

  function deskAdminUsersPath(options) {
    var params = {};
    setParam(params, "user", options && (options.userId !== undefined ? options.userId : options.user));
    return withQuery("/desk/admin/users", params);
  }

  function deskAdminCustomFieldsPath(doctype) {
    var params = {};
    setParam(params, "doctype", doctype);
    return withQuery("/desk/admin/custom-fields", params);
  }

  function deskAdminFieldPropertiesPath(doctype, field) {
    var params = {};
    setParam(params, "doctype", doctype);
    setParam(params, "field", field);
    return withQuery("/desk/admin/field-properties", params);
  }

  function deskAdminUserPermissionsPath(options) {
    var params = {};
    setParam(params, "user", options && (options.userId !== undefined ? options.userId : options.user));
    return withQuery("/desk/admin/user-permissions", params);
  }

  function deskAdminWorkflowsPath(doctype) {
    var params = {};
    setParam(params, "doctype", doctype);
    return withQuery("/desk/admin/workflows", params);
  }

  function deskFilesPath(options) {
    return withQuery("/desk/files", fileListParams(options || {}));
  }

  function deskFilePath(name, action) {
    return "/desk/files/" + encodePart(name) + (action === undefined ? "" : "/" + action);
  }

  function deskNotificationInboxParams(options) {
    var params = {};
    setParam(params, "limit", options && options.limit);
    setParam(params, "unread", options && options.unread);
    setParam(params, "include_dismissed", options && (options.includeDismissed !== undefined ? options.includeDismissed : options.include_dismissed));
    return params;
  }

  function deskNotificationsPath(options) {
    return withQuery("/desk/notifications", deskNotificationInboxParams(options || {}));
  }

  function deskSearchPath(q, options) {
    return withQuery("/desk/search", searchParams(q, options || {}));
  }

  function deskPrintPath(format, name) {
    return "/desk/print/" + encodePart(format) + "/" + encodePart(name);
  }

  function deskPrintPdfPath(format, name) {
    return deskPrintPath(format, name) + "/pdf";
  }

  function deskReportBuilderPath(doctype, id, options) {
    var path = "/desk/report-builder/" + encodePart(doctype) + (id === undefined ? "" : "/" + encodePart(id));
    return withQuery(path, reportRunParams(options || {}));
  }

  function deskReportBuilderPdfPath(doctype, id, options) {
    return withQuery("/desk/report-builder/" + encodePart(doctype) + "/" + encodePart(id) + "/pdf", reportRunParams(options || {}));
  }

  function deskReportPath(report, options) {
    return withQuery("/desk/reports/" + encodePart(report), reportRunParams(options || {}));
  }

  function deskReportPdfPath(report, options) {
    return withQuery("/desk/reports/" + encodePart(report) + "/pdf", reportRunParams(options || {}));
  }

  function deskWorkspacePath(workspace) {
    return "/desk/workspaces/" + encodePart(workspace);
  }

  function resourceActionPath(doctype, name, action) {
    return resourcePath(doctype, name) + "/" + action;
  }

  function resourceMemberPath(doctype, name, action, member) {
    return resourceActionPath(doctype, name, action) + "/" + encodePart(member);
  }

  function filePath(name, action) {
    return "/api/files/" + encodePart(name) + (action === undefined ? "" : "/" + action);
  }

  function profilePath(userId, options) {
    return withQuery("/api/users/" + encodePart(userId) + "/profile", tenantParams(options || {}));
  }

  function accountPath(userId, action, options) {
    return withQuery("/api/users/" + encodePart(userId) + (action === undefined ? "" : "/" + action), tenantParams(options || {}));
  }

  function notificationActionPath(notificationId, action, options) {
    return withQuery("/api/notifications/" + encodePart(notificationId) + "/" + action, notificationCommandParams(options || {}));
  }

  function notificationRulePath(doctype, rule, options) {
    return withQuery("/api/notification-rules/" + encodePart(doctype) + (rule === undefined ? "" : "/" + encodePart(rule)), tenantParams(options || {}));
  }

  function rolesPath(options) {
    return withQuery("/api/roles", tenantParams(options || {}));
  }

  function rolePath(role, options) {
    return withQuery("/api/roles/" + encodePart(role), tenantParams(options || {}));
  }

  function roleActionPath(role, action, options) {
    return withQuery("/api/roles/" + encodePart(role) + "/" + action, tenantParams(options || {}));
  }

  function customFieldPath(doctype, field, options) {
    return withQuery("/api/custom-fields/" + encodePart(doctype) + (field === undefined ? "" : "/" + encodePart(field)), tenantParams(options || {}));
  }

  function fieldPropertyPath(doctype, field, options) {
    return withQuery("/api/field-properties/" + encodePart(doctype) + (field === undefined ? "" : "/" + encodePart(field)), tenantParams(options || {}));
  }

  function workflowPath(doctype, options) {
    return withQuery("/api/workflows/" + encodePart(doctype), tenantParams(options || {}));
  }

  function userPermissionPath(userId, options) {
    return withQuery("/api/user-permissions/" + encodePart(userId), tenantParams(options || {}));
  }

  function dataPatchPath(patchId, action) {
    return "/api/data-patches" + (patchId === undefined ? "" : "/" + encodePart(patchId)) + (action === undefined ? "" : "/" + action);
  }

  function dashboardPath(dashboard, action) {
    return (dashboard === undefined ? "/api/meta/dashboards" : "/api/dashboard/" + encodePart(dashboard)) + (action === undefined ? "" : "/" + action);
  }

  function dashboardMetaPath(dashboard) {
    return "/api/meta/dashboards" + (dashboard === undefined ? "" : "/" + encodePart(dashboard));
  }

  function kanbanPath(kanban, action) {
    return (kanban === undefined ? "/api/meta/kanbans" : "/api/kanban/" + encodePart(kanban)) + (action === undefined ? "" : "/" + action);
  }

  function kanbanMetaPath(kanban) {
    return "/api/meta/kanbans" + (kanban === undefined ? "" : "/" + encodePart(kanban));
  }

  function calendarPath(calendar, action, options) {
    return withQuery((calendar === undefined ? "/api/meta/calendars" : "/api/calendar/" + encodePart(calendar)) + (action === undefined ? "" : "/" + action), calendarParams(options || {}));
  }

  function calendarMetaPath(calendar) {
    return "/api/meta/calendars" + (calendar === undefined ? "" : "/" + encodePart(calendar));
  }

  function reportBuilderPath(doctype, id, action) {
    return "/api/report-builder/" + encodePart(doctype) + (id === undefined ? "" : "/" + encodePart(id)) + (action === undefined ? "" : "/" + action);
  }

  function reportPath(report, action) {
    return "/api/report/" + encodePart(report) + (action === undefined ? "" : "/" + action);
  }

  function reportPdfPath(report, options) {
    return withQuery(reportPath(report, "pdf"), reportRunParams(options || {}));
  }

  function reportBuilderPdfPath(doctype, id, options) {
    return withQuery(reportBuilderPath(doctype, id, "pdf"), reportRunParams(options || {}));
  }

  function auditDeletedPath(doctype, name, options) {
    return withQuery("/api/audit/deleted/" + encodePart(doctype) + "/" + encodePart(name), tenantParams(options || {}));
  }

  function linkOptionsPath(doctype, field, params) {
    return withQuery("/api/link-options/" + encodePart(doctype) + "/" + encodePart(field), params || {});
  }

  function printDocumentPath(format, name) {
    return "/api/print/" + encodePart(format) + "/" + encodePart(name);
  }

  function printPdfDocumentPath(format, name) {
    return printDocumentPath(format, name) + "/pdf";
  }

  function printFormatPath(format) {
    return "/api/meta/print-formats" + (format === undefined ? "" : "/" + encodePart(format));
  }

  function printLetterheadPath(letterhead) {
    return "/api/meta/print-letterheads" + (letterhead === undefined ? "" : "/" + encodePart(letterhead));
  }

  function printSettingsPath(options) {
    return withQuery("/api/print-settings", tenantParams(options || {}));
  }

  function jobExecutionPath(idempotencyKey, action) {
    return "/api/jobs/executions/" + encodePart(idempotencyKey) + (action === undefined ? "" : "/" + action);
  }

  function jobSchedulePath(scheduleId, action) {
    return "/api/jobs/schedules" + (scheduleId === undefined ? "" : "/" + encodePart(scheduleId)) + (action === undefined ? "" : "/" + action);
  }

  function versionBody(options) {
    return options && options.expectedVersion !== undefined ? { expectedVersion: options.expectedVersion } : {};
  }

  function withoutKeys(input, keys) {
    var excluded = {};
    keys.forEach(function (key) {
      excluded[key] = true;
    });
    var body = {};
    Object.entries(input || {}).forEach(function (entry) {
      if (!excluded[entry[0]]) {
        body[entry[0]] = entry[1];
      }
    });
    return body;
  }

  function commandBody(input, options) {
    return Object.assign(withoutKeys(input, ["expectedVersion"]), versionBody(options));
  }

  function commentBody(input, options) {
    return commandBody(typeof input === "string" ? { text: input } : input, options);
  }

  function descriptionBody(input, options) {
    return commandBody(typeof input === "string" ? { description: input } : input, options);
  }

  function passwordBody(input, options) {
    return commandBody(typeof input === "string" ? { password: input } : input, options);
  }

  function rolesBody(input, options) {
    return commandBody(Array.isArray(input) ? { roles: input } : input, options);
  }

  function customFieldBody(field, options) {
    var bodyField = isPlainObject(field) ? withoutKeys(field, ["expectedVersion"]) : field;
    return Object.assign({ field: bodyField }, versionBody(options));
  }

  function notificationRuleBody(rule, options) {
    var bodyRule = isPlainObject(rule) ? withoutKeys(rule, ["name", "expectedVersion"]) : rule;
    return Object.assign({ rule: bodyRule }, versionBody(options));
  }

  function requiredNotificationRuleEvents(rule, ruleName) {
    if (!Array.isArray(rule.events) || rule.events.length === 0) {
      throw new Error("Notification rule '" + ruleName + "' cannot be toggled because it has no events");
    }
    return rule.events;
  }

  function requiredNotificationRuleRecipients(rule, ruleName) {
    if (!Array.isArray(rule.recipients) || rule.recipients.length === 0) {
      throw new Error("Notification rule '" + ruleName + "' cannot be toggled because it has no recipients");
    }
    return rule.recipients;
  }

  function notificationRuleToggleBody(ruleName, state, enabled, options) {
    var expectedVersion = options && options.expectedVersion;
    if (expectedVersion !== undefined && state && state.version !== undefined && state.version !== expectedVersion) {
      throw new Error("Expected notification rules at version " + String(expectedVersion) + ", found " + String(state.version));
    }
    var entry = notificationRuleEntry(ruleName, state);
    var rule = entry.rule;
    var bodyRule = {
      events: requiredNotificationRuleEvents(rule, ruleName).slice(),
      recipients: requiredNotificationRuleRecipients(rule, ruleName).slice()
    };
    if (Array.isArray(rule.channels) && rule.channels.length > 0) {
      bodyRule.channels = rule.channels.slice();
    }
    if (rule.condition !== undefined) {
      bodyRule.condition = rule.condition;
    }
    bodyRule.enabled = enabled;
    if (rule.subject !== undefined) {
      bodyRule.subject = rule.subject;
    }
    if (rule.excludeActor !== undefined) {
      bodyRule.excludeActor = rule.excludeActor;
    }
    return {
      rule: bodyRule,
      expectedVersion: expectedVersion !== undefined ? expectedVersion : state && state.version !== undefined ? state.version : 0
    };
  }

  function notificationRuleEntry(ruleName, state) {
    var entry = ((state && state.rules) || []).find(function (item) {
      return item && item.rule && item.rule.name === ruleName;
    });
    if (entry === undefined) {
      throw new Error("Notification rule '" + ruleName + "' was not found in remote state");
    }
    return entry;
  }

  async function getNotificationRule(doctype, rule, options) {
    var state = unwrapData(await request(notificationRulePath(doctype, rule, options || {})));
    return notificationRuleEntry(rule, state);
  }

  async function toggleNotificationRule(doctype, rule, enabled, options) {
    var commandOptions = options || {};
    var state = unwrapData(await request(notificationRulePath(doctype, undefined, commandOptions)));
    return request(notificationRulePath(doctype, rule, commandOptions), {
      method: "PUT",
      body: notificationRuleToggleBody(rule, state, enabled, commandOptions)
    }).then(unwrapData);
  }

  function fieldPropertyBody(overrides, options) {
    var bodyOverrides = isPlainObject(overrides) ? withoutKeys(overrides, ["expectedVersion"]) : overrides;
    return Object.assign({ overrides: bodyOverrides }, versionBody(options));
  }

  function workflowBody(workflow, options) {
    var bodyWorkflow = isPlainObject(workflow) ? withoutKeys(workflow, ["expectedVersion"]) : workflow;
    return Object.assign({ workflow: bodyWorkflow }, versionBody(options));
  }

  function userPermissionBody(grant, options) {
    return commandBody(grant || {}, options);
  }

  function dataPatchBody(options, includePatchIds) {
    return includePatchIds === false ? withoutKeys(options || {}, ["patchIds"]) : Object.assign({}, options || {});
  }

  function savedFilterBody(input) {
    return withoutKeys(input, ["id"]);
  }

  function bulkDocumentsBody(documents) {
    return { documents: documents };
  }

  function bulkFilesBody(files, input) {
    return Object.assign({}, input || {}, { files: files });
  }

  function setParam(params, key, value) {
    if (value !== undefined && value !== null) {
      params[key] = value;
    }
  }

  function setFormParam(params, key, value) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }

  function tenantParams(options) {
    var params = {};
    setParam(params, "tenant", options && options.tenant);
    return params;
  }

  function notificationInboxParams(options) {
    var params = {};
    setParam(params, "user", options && options.user);
    setParam(params, "limit", options && options.limit);
    setParam(params, "unread", options && options.unread);
    setParam(params, "include_dismissed", options && (options.includeDismissed !== undefined ? options.includeDismissed : options.include_dismissed));
    return params;
  }

  function notificationCommandParams(options) {
    var params = {};
    setParam(params, "user", options && options.user);
    return params;
  }

  function fileAttachmentParams(params, options) {
    var attachedTo = options && options.attachedTo;
    if (attachedTo) {
      setParam(params, "attached_to_doctype", attachedTo.doctype);
      setParam(params, "attached_to_name", attachedTo.name);
      return;
    }
    if (options && (options.attached_to_doctype !== undefined || options.attached_to_name !== undefined)) {
      setParam(params, "attached_to_doctype", options.attached_to_doctype);
      setParam(params, "attached_to_name", options.attached_to_name);
    }
  }

  function fileListParams(options) {
    var params = {};
    fileAttachmentParams(params, options || {});
    setParam(params, "content_type", options && (options.contentType !== undefined ? options.contentType : options.content_type));
    setParam(params, "filename", options && options.filename);
    setParam(params, "is_private", options && (options.isPrivate !== undefined ? options.isPrivate : options.is_private));
    setParam(params, "limit", options && options.limit);
    setParam(params, "scan_status", options && (options.scanStatus !== undefined ? options.scanStatus : options.scan_status));
    setParam(params, "storage_state", options && (options.storageState !== undefined ? options.storageState : options.storage_state));
    setParam(params, "uploaded_by", options && (options.uploadedBy !== undefined ? options.uploadedBy : options.uploaded_by));
    return params;
  }

  function fileUploadParams(options) {
    var params = {};
    fileAttachmentParams(params, options || {});
    setParam(params, "filename", options && options.filename);
    setParam(params, "is_private", options && (options.isPrivate !== undefined ? options.isPrivate : options.is_private));
    return params;
  }

  function fileUploadHeaders(options) {
    var headers = {};
    var contentType = options && (options.contentType !== undefined ? options.contentType : options.content_type);
    if (contentType !== undefined && contentType !== null) {
      headers["content-type"] = contentType;
    }
    return headers;
  }

  function fileUploadLimit(options) {
    var raw = options && (options.maxUploadBytes !== undefined ? options.maxUploadBytes : options.max_upload_bytes);
    var parsed = raw === undefined ? NaN : Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  function preflightKnownUploadSize(size, options) {
    var maxUploadBytes = fileUploadLimit(options || {});
    if (maxUploadBytes === undefined || typeof size !== "number" || !Number.isFinite(size)) {
      return;
    }
    if (size > maxUploadBytes) {
      throw new Error("File exceeds " + String(maxUploadBytes) + " bytes");
    }
  }

  function uploadBodySize(body) {
    return body && typeof body.size === "number" && Number.isFinite(body.size) ? body.size : undefined;
  }

  function directUploadRequestBody(input) {
    var body = Object.assign({}, input || {});
    delete body.maxUploadBytes;
    delete body.max_upload_bytes;
    return body;
  }

  function uploadReservationRequestBody(input) {
    return directUploadRequestBody(input);
  }

  function fileTransformParams(options) {
    var params = {};
    setParam(params, "width", options && options.width);
    setParam(params, "height", options && options.height);
    setParam(params, "fit", options && options.fit);
    setParam(params, "format", options && options.format);
    setParam(params, "quality", options && options.quality);
    setParam(params, "watermark", fileWatermarkText(options && options.watermark));
    setParam(params, "watermarkPlacement", fileWatermarkField(options && options.watermark, "placement"));
    setParam(params, "watermarkOpacity", fileWatermarkField(options && options.watermark, "opacity"));
    setParam(params, "watermarkColor", fileWatermarkField(options && options.watermark, "color"));
    setParam(params, "watermarkFontSize", fileWatermarkField(options && options.watermark, "fontSize"));
    setParam(params, "overlay", fileOverlayFile(options && options.overlay));
    setParam(params, "overlayPlacement", fileOverlayField(options && options.overlay, "placement"));
    setParam(params, "overlayOpacity", fileOverlayField(options && options.overlay, "opacity"));
    setParam(params, "overlayWidth", fileOverlayField(options && options.overlay, "width"));
    setParam(params, "overlayHeight", fileOverlayField(options && options.overlay, "height"));
    return params;
  }

  function fileWatermarkText(value) {
    if (value && typeof value === "object") {
      return value.text;
    }
    return value;
  }

  function fileWatermarkField(value, field) {
    if (value && typeof value === "object") {
      return value[field];
    }
    return undefined;
  }

  function fileOverlayFile(value) {
    if (value && typeof value === "object") {
      return value.file;
    }
    return value;
  }

  function fileOverlayField(value, field) {
    if (value && typeof value === "object") {
      return value[field];
    }
    return undefined;
  }

  var minMultipartChunkBytes = ${JSON.stringify(MIN_MULTIPART_FILE_PART_BYTES)};
  var maxMultipartFileParts = ${JSON.stringify(MAX_MULTIPART_FILE_PARTS)};
  var defaultMultipartChunkBytes = minMultipartChunkBytes;

  function fileBodySize(body) {
    if (body && typeof body.size === "number" && Number.isFinite(body.size)) {
      return body.size;
    }
    throw new Error("Multipart file body must expose a numeric size");
  }

  function multipartFilename(body, options) {
    var filename = options && options.filename;
    if (filename !== undefined && filename !== null && String(filename) !== "") {
      return filename;
    }
    if (body && typeof body.name === "string" && body.name !== "") {
      return body.name;
    }
    throw new Error("filename is required for multipart uploads");
  }

  function multipartContentType(body, options) {
    var contentType = options && (options.contentType !== undefined ? options.contentType : options.content_type);
    if (contentType !== undefined && contentType !== null && String(contentType) !== "") {
      return contentType;
    }
    return body && typeof body.type === "string" && body.type !== "" ? body.type : "application/octet-stream";
  }

  function multipartChunkSize(options) {
    var chunkSize = options && options.chunkSize !== undefined ? Number(options.chunkSize) : defaultMultipartChunkBytes;
    if (!Number.isInteger(chunkSize) || chunkSize < 1) {
      throw new Error("chunkSize must be a positive integer");
    }
    return chunkSize;
  }

  function assertMultipartUploadPlan(size, chunkSize) {
    var totalParts = Math.max(1, Math.ceil(size / chunkSize));
    if (totalParts > 1 && chunkSize < minMultipartChunkBytes) {
      throw new Error("chunkSize must be at least " + String(minMultipartChunkBytes) + " bytes for multi-part R2 uploads");
    }
    if (totalParts > maxMultipartFileParts) {
      throw new Error("Multipart upload cannot exceed " + String(maxMultipartFileParts) + " parts");
    }
    return totalParts;
  }

  function multipartReservationBody(body, options) {
    var input = {
      filename: multipartFilename(body, options || {}),
      size: fileBodySize(body),
      contentType: multipartContentType(body, options || {})
    };
    fileAttachmentParams(input, options || {});
    if (options && (options.isPrivate !== undefined || options.is_private !== undefined)) {
      input.isPrivate = options.isPrivate !== undefined ? options.isPrivate : options.is_private;
    }
    if (options && options.expiresInSeconds !== undefined) {
      input.expiresInSeconds = options.expiresInSeconds;
    }
    return input;
  }

  function directReservationBody(body, options) {
    var input = multipartReservationBody(body, options || {});
    var maxUploadBytes = options && (options.maxUploadBytes !== undefined ? options.maxUploadBytes : options.max_upload_bytes);
    if (maxUploadBytes !== undefined) {
      input.maxUploadBytes = maxUploadBytes;
    }
    return input;
  }

  function multipartPartBody(body, start, end) {
    if (body && typeof body.slice === "function") {
      return body.slice(start, end);
    }
    throw new Error("Multipart file body must support slice(start, end)");
  }

  function snapshotVersion(payload, fallback) {
    return payload && payload.data && payload.data.version !== undefined ? payload.data.version : fallback;
  }

  function multipartProgress(callback, event) {
    if (typeof callback === "function") {
      callback(event);
    }
  }

  async function prepareMultipartUpload(input) {
    preflightKnownUploadSize(input && input.size, input || {});
    return request("/api/files/multipart-upload", { method: "POST", body: uploadReservationRequestBody(input || {}) });
  }

  async function prepareDirectUpload(input) {
    preflightKnownUploadSize(input && input.size, input || {});
    return request("/api/files/direct-upload", { method: "POST", body: directUploadRequestBody(input || {}) });
  }

  function completeDirectUpload(name, options) {
    return request(filePath(name, "complete-upload"), { method: "POST", body: versionBody(options) }).then(unwrapData);
  }

  async function uploadDirectFile(body, options) {
    var prepared = await prepareDirectUpload(directReservationBody(body, options || {}));
    var file = prepared && prepared.data;
    var upload = prepared && prepared.upload;
    if (!file || !file.name || !upload || !upload.url) {
      throw new Error("Direct upload reservation did not return upload instructions");
    }
    var uploadResponse = await fetch(upload.url, {
      method: upload.method || "PUT",
      headers: upload.headers || {},
      body: body
    });
    if (!uploadResponse.ok) {
      throwResponseError(uploadResponse, await readResponsePayload(uploadResponse));
    }
    return {
      data: await completeDirectUpload(file.name, { expectedVersion: file.version }),
      upload: upload
    };
  }

  function uploadMultipartPart(name, partNumber, body, options) {
    var headers = {};
    if (options && options.size !== undefined) {
      headers["x-cf-frappe-part-size"] = String(options.size);
    }
    return request(filePath(name, "multipart-parts/" + encodePart(partNumber)), {
      method: "PUT",
      body: body,
      headers: headers
    });
  }

  function completeMultipartUpload(name, parts, options) {
    return request(filePath(name, "complete-multipart-upload"), {
      method: "POST",
      body: Object.assign({ parts: parts }, versionBody(options))
    }).then(unwrapData);
  }

  function abortMultipartUpload(name, options) {
    return request(filePath(name, "abort-multipart-upload"), {
      method: "POST",
      body: versionBody(options)
    }).then(unwrapData);
  }

  async function uploadMultipartFile(body, options) {
    var input = multipartReservationBody(body, options || {});
    var chunkSize = multipartChunkSize(options || {});
    var size = input.size;
    preflightKnownUploadSize(size, options || {});
    var totalParts = assertMultipartUploadPlan(size, chunkSize);
    var prepared = await prepareMultipartUpload(input);
    var fileName = prepared && prepared.data && prepared.data.name;
    if (!fileName) {
      throw new Error("Multipart upload reservation did not return a file name");
    }
    var expectedVersion = snapshotVersion(prepared, undefined);
    var parts = [];
    var uploadedBytes = 0;
    var canAbort = true;
    try {
      for (var partNumber = 1, start = 0; partNumber <= totalParts; partNumber += 1, start += chunkSize) {
        var end = Math.min(start + chunkSize, size);
        var chunk = multipartPartBody(body, start, end);
        var uploaded = await uploadMultipartPart(fileName, partNumber, chunk, { size: end - start });
        parts.push(uploaded.part);
        expectedVersion = snapshotVersion(uploaded, expectedVersion);
        uploadedBytes += end - start;
        multipartProgress(options && options.onProgress, {
          file: prepared.data,
          part: uploaded.part,
          partNumber: partNumber,
          totalParts: totalParts,
          uploadedBytes: uploadedBytes,
          totalBytes: size
        });
      }
      canAbort = false;
      var completed = await completeMultipartUpload(fileName, parts, { expectedVersion: expectedVersion });
      return {
        data: completed,
        upload: prepared.upload,
        parts: parts
      };
    } catch (error) {
      if (canAbort && (!options || options.abortOnError !== false)) {
        await abortMultipartUpload(fileName, { expectedVersion: expectedVersion }).catch(function () {});
      }
      throw error;
    }
  }

  function auditEventParams(options) {
    var params = {};
    setParam(params, "tenant", options && options.tenant);
    setParam(params, "doctype", options && options.doctype);
    setParam(params, "name", options && options.name);
    setParam(params, "actor_id", options && (options.actorId !== undefined ? options.actorId : options.actor_id));
    setParam(params, "kind", options && options.kind);
    setParam(params, "since", options && options.since);
    setParam(params, "until", options && options.until);
    setParam(params, "limit", options && options.limit);
    return params;
  }

  function printFormatParams(options) {
    var params = {};
    setParam(params, "doctype", options && options.doctype);
    return params;
  }

  function reportRunParams(options) {
    var params = {};
    Object.entries((options && options.filters) || {}).forEach(function (entry) {
      appendFilterParams(params, entry[0], entry[1]);
    });
    setFilterExpressionParam(
      params,
      options && (options.filterExpression !== undefined ? options.filterExpression : options.filter_expression)
    );
    setParam(params, "order_by", options && (options.orderBy !== undefined ? options.orderBy : options.order_by));
    setParam(params, "order", options && options.order);
    setParam(params, "limit", options && options.limit);
    setParam(params, "offset", options && options.offset);
    return params;
  }

  function reportExportParams(options) {
    var params = reportRunParams(options);
    delete params.offset;
    return params;
  }

  function calendarParams(options) {
    var params = {};
    setParam(params, "from", options && options.from);
    setParam(params, "to", options && options.to);
    setParam(params, "limit", options && options.limit);
    return params;
  }

  function searchParams(q, options) {
    var params = {};
    setParam(params, "q", q);
    setParam(params, "limit", options && options.limit);
    setParam(params, "tenant", options && options.tenant);
    return params;
  }

  function currentDeskListReturnTo(doctype) {
    try {
      var current = new URL(root.location.href);
      return current.pathname === deskPath(doctype) ? current.pathname + current.search : undefined;
    } catch (_error) {
      return undefined;
    }
  }

  function deskImportBody(doctype, csv, options) {
    var body = new URLSearchParams();
    var returnTo = options && options.returnTo !== undefined ? options.returnTo : currentDeskListReturnTo(doctype);
    setFormParam(body, "mode", options && options.mode);
    setFormParam(body, "returnTo", returnTo);
    body.set("csv", csv || "");
    return body;
  }

  function deskBulkDocumentsBody(doctype, documents, options) {
    var body = new URLSearchParams();
    var returnTo = options && options.returnTo !== undefined ? options.returnTo : currentDeskListReturnTo(doctype);
    setFormParam(body, "returnTo", returnTo);
    (documents || []).forEach(function (document) {
      var name = typeof document === "string" ? document : document && document.name;
      if (name === undefined || name === null) {
        return;
      }
      body.append("document", String(name));
      var expectedVersion = typeof document === "string" ? undefined : document.expectedVersion;
      setFormParam(body, "expectedVersion:" + String(name), expectedVersion);
    });
    return body;
  }

  function jobDashboardParams(options) {
    var params = {};
    setParam(params, "job", options && (options.jobName !== undefined ? options.jobName : options.job));
    setParam(params, "run_id", options && (options.runId !== undefined ? options.runId : options.run_id));
    setParam(params, "status", options && options.status);
    setParam(params, "limit", options && options.limit);
    return params;
  }

  function jobScheduleParams(options) {
    var params = {};
    setParam(params, "cron", options && options.cron);
    setParam(params, "job", options && (options.jobName !== undefined ? options.jobName : options.job));
    return params;
  }

  function timelineParams(options) {
    var params = {};
    if (options && options.limit !== undefined && options.limit !== null) {
      params.limit = options.limit;
    }
    if (options && options.beforeSequence !== undefined && options.beforeSequence !== null) {
      params.before_sequence = options.beforeSequence;
    } else if (options && options.before_sequence !== undefined && options.before_sequence !== null) {
      params.before_sequence = options.before_sequence;
    }
    return params;
  }

  function documentTopic(tenantId, doctype, name) {
    return "document:" + encodePart(tenantId) + ":" + encodePart(doctype) + ":" + encodePart(name);
  }

  function doctypeTopic(tenantId, doctype) {
    return "doctype:" + encodePart(tenantId) + ":" + encodePart(doctype);
  }

  function tenantTopic(tenantId) {
    return "tenant:" + encodePart(tenantId);
  }

  function userTopic(tenantId, userId) {
    return "user:" + encodePart(tenantId) + ":" + encodePart(userId);
  }

  function tenantIdFromOptions(options, label) {
    var tenantId = options && (options.tenantId || (options.document && options.document.tenantId));
    if (!tenantId) {
      throw new Error("tenantId is required for " + label + " realtime subscriptions");
    }
    return tenantId;
  }

  function doctypeTopicFromOptions(doctype, options) {
    return doctypeTopic(tenantIdFromOptions(options, "doctype"), doctype);
  }

  function documentTopicFromOptions(doctype, name, options) {
    return documentTopic(tenantIdFromOptions(options, "document"), doctype, name);
  }

  function tenantTopicFromOptions(options) {
    return tenantTopic(tenantIdFromOptions(options, "tenant"));
  }

  function userTopicFromOptions(userId, options) {
    var resolvedUserId = userId || (options && options.userId);
    if (!resolvedUserId) {
      throw new Error("userId is required for user realtime subscriptions");
    }
    return userTopic(tenantIdFromOptions(options, "user"), resolvedUserId);
  }

  function runtimeScript() {
    return document.querySelector('script[data-cf-frappe-runtime="desk"]');
  }

  function context(script) {
    var source = script || document.currentScript || runtimeScript();
    var dataset = source && source.dataset ? source.dataset : {};
    var documentVersion = Number(dataset.documentVersion);
    var pageContext = {
      doctype: dataset.doctype,
      documentName: dataset.documentName,
      realtimeRoute: dataset.realtimeRoute,
      script: dataset.cfFrappeScript,
      scope: dataset.scope,
      tenantId: dataset.tenantId
    };
    if (dataset.documentStatus !== undefined) {
      pageContext.documentStatus = dataset.documentStatus;
    }
    if (Number.isInteger(documentVersion) && documentVersion >= 0) {
      pageContext.documentVersion = documentVersion;
    }
    return pageContext;
  }

  function ready(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
      return;
    }
    callback();
  }

  function hydrateFileUploadForms() {
    var forms = document.querySelectorAll("form.file-upload[data-max-file-bytes], form.attachment-upload[data-max-file-bytes]");
    if (!forms || forms.length === 0) {
      return;
    }
    Array.prototype.forEach.call(forms, hydrateFileUploadForm);
  }

  function hydrateFileUploadForm(form) {
    if (!form || form.__cfFrappeFileUploadHydrated) {
      return;
    }
    form.__cfFrappeFileUploadHydrated = true;
    form.addEventListener("submit", async function (event) {
      var maxFileBytes = uploadFormMaxFileBytes(form);
      var file = selectedUploadFile(form);
      if (!file) {
        clearUploadFileValidity(form);
        return;
      }
      if (maxFileBytes !== undefined && typeof file.size === "number" && Number.isFinite(file.size) && file.size > maxFileBytes) {
        var message = "File exceeds " + String(maxFileBytes) + " bytes";
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        setUploadFileValidity(form, message, true);
        msgprint(message);
        return;
      }
      clearUploadFileValidity(form);
      if (!form.dataset || form.dataset.uploadMode !== "direct") {
        return;
      }
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (form.__cfFrappeFileUploadInFlight) {
        return;
      }
      form.__cfFrappeFileUploadInFlight = true;
      try {
        await uploadDirectFile(file, uploadFormDirectOptions(form, file, maxFileBytes));
        clearUploadFileValidity(form);
        if (window.location) {
          window.location.href = uploadFormSuccessUrl(form);
        }
      } catch (error) {
        var errorMessage = error && error.message ? error.message : String(error);
        setUploadFileValidity(form, errorMessage, true);
        msgprint(errorMessage);
      } finally {
        form.__cfFrappeFileUploadInFlight = false;
      }
    });
  }

  function uploadFormMaxFileBytes(form) {
    var raw = form.dataset && form.dataset.maxFileBytes;
    var parsed = raw === undefined ? NaN : Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  function selectedUploadFile(form) {
    var input = typeof form.querySelector === "function"
      ? form.querySelector('input[type="file"][name="file"], input[type="file"]')
      : null;
    if (!input || !input.files || input.files.length === 0) {
      return undefined;
    }
    return input.files[0];
  }

  function uploadFormControl(form, name) {
    return typeof form.querySelector === "function" ? form.querySelector('[name="' + name + '"]') : null;
  }

  function uploadFormValue(form, name) {
    var control = uploadFormControl(form, name);
    if (!control || control.value === undefined || control.value === null || String(control.value) === "") {
      return undefined;
    }
    return control.value;
  }

  function uploadFormChecked(form, name) {
    var control = uploadFormControl(form, name);
    return control ? Boolean(control.checked) : undefined;
  }

  function uploadFormDirectOptions(form, file, maxFileBytes) {
    var options = {
      filename: file && file.name ? file.name : uploadFormValue(form, "filename"),
      contentType: file && file.type ? file.type : undefined
    };
    var attachedToDoctype = form.dataset && form.dataset.attachedToDoctype
      ? form.dataset.attachedToDoctype
      : uploadFormValue(form, "attached_to_doctype");
    var attachedToName = form.dataset && form.dataset.attachedToName
      ? form.dataset.attachedToName
      : uploadFormValue(form, "attached_to_name");
    if (attachedToDoctype || attachedToName) {
      options.attachedTo = { doctype: attachedToDoctype, name: attachedToName };
    }
    var isPrivate = uploadFormChecked(form, "is_private");
    if (isPrivate !== undefined) {
      options.isPrivate = isPrivate;
    }
    if (maxFileBytes !== undefined) {
      options.maxUploadBytes = maxFileBytes;
    }
    return options;
  }

  function uploadFormSuccessUrl(form) {
    return form.dataset && form.dataset.successUrl ? form.dataset.successUrl : window.location.href;
  }

  function setUploadFileValidity(form, message, report) {
    var input = typeof form.querySelector === "function"
      ? form.querySelector('input[type="file"][name="file"], input[type="file"]')
      : null;
    if (input && typeof input.setCustomValidity === "function") {
      input.setCustomValidity(message);
    }
    if (report && input && typeof input.reportValidity === "function") {
      input.reportValidity();
    }
  }

  function clearUploadFileValidity(form) {
    setUploadFileValidity(form, "", false);
  }

  function hydrateCompoundFilterBuilders() {
    var builders = document.querySelectorAll("[data-cf-frappe-compound-filter-builder]");
    if (!builders || builders.length === 0) {
      return;
    }
    Array.prototype.forEach.call(builders, hydrateCompoundFilterBuilder);
  }

  function hydrateCompoundFilterBuilder(builder) {
    var form = typeof builder.closest === "function" ? builder.closest("form") : null;
    if (!form || builder.__cfFrappeCompoundFilterHydrated) {
      return;
    }
    builder.__cfFrappeCompoundFilterHydrated = true;
    var expression = builder.querySelector('[name="filter_expression"]');
    if (expression) {
      expression.addEventListener("input", function () {
        builder.__cfFrappeCompoundFilterSource = "text";
      });
      expression.addEventListener("change", function () {
        builder.__cfFrappeCompoundFilterSource = "text";
      });
    }
    var root = builder.querySelector("[data-cf-frappe-filter-group]");
    if (root) {
      hydrateCompoundFilterGroup(builder, root);
    } else {
      Array.prototype.forEach.call(builder.querySelectorAll("[data-cf-frappe-filter-row]"), function (row) {
        hydrateCompoundFilterRow(builder, row);
      });
    }
    form.addEventListener("submit", function () {
      syncCompoundFilterExpression(builder);
    });
  }

  function hydrateCompoundFilterGroup(builder, group) {
    if (!group || group.__cfFrappeCompoundFilterGroupHydrated) {
      return;
    }
    group.__cfFrappeCompoundFilterGroupHydrated = true;
    var match = group.querySelector("[data-cf-frappe-filter-match]");
    if (match) {
      match.addEventListener("change", function () {
        markCompoundFilterVisualDirty(builder);
      });
    }
    var addButton = group.querySelector("[data-cf-frappe-add-filter]");
    if (addButton) {
      addButton.addEventListener("click", function () {
        addCompoundFilterRow(builder, group);
      });
    }
    var addGroupButton = group.querySelector("[data-cf-frappe-add-filter-group]");
    if (addGroupButton) {
      addGroupButton.addEventListener("click", function () {
        addCompoundFilterGroup(builder, group);
      });
    }
    var removeGroupButton = group.querySelector("[data-cf-frappe-remove-filter-group]");
    if (removeGroupButton) {
      removeGroupButton.addEventListener("click", function () {
        markCompoundFilterVisualDirty(builder);
        removeCompoundFilterGroup(builder, group);
      });
    }
    Array.prototype.forEach.call(group.querySelectorAll("[data-cf-frappe-filter-row]"), function (row) {
      hydrateCompoundFilterRow(builder, row);
    });
    Array.prototype.forEach.call(group.querySelectorAll("[data-cf-frappe-filter-group]"), function (childGroup) {
      hydrateCompoundFilterGroup(builder, childGroup);
    });
  }

  function hydrateCompoundFilterRow(builder, row) {
    if (row.__cfFrappeCompoundFilterRowHydrated) {
      return;
    }
    row.__cfFrappeCompoundFilterRowHydrated = true;
    var field = row.querySelector("[data-cf-frappe-filter-field]");
    var operator = row.querySelector("[data-cf-frappe-filter-operator]");
    var remove = row.querySelector("[data-cf-frappe-remove-filter]");
    if (field) {
      field.addEventListener("change", function () {
        markCompoundFilterVisualDirty(builder);
        refreshCompoundFilterOperatorOptions(builder, row);
        refreshCompoundFilterValueInputType(builder, row);
      });
    }
    if (operator) {
      operator.addEventListener("change", function () {
        markCompoundFilterVisualDirty(builder);
        refreshCompoundFilterValueInputType(builder, row);
      });
    }
    Array.prototype.forEach.call(row.querySelectorAll("select, input"), function (control) {
      control.addEventListener("input", function () {
        markCompoundFilterVisualDirty(builder);
      });
      control.addEventListener("change", function () {
        markCompoundFilterVisualDirty(builder);
      });
    });
    if (remove) {
      remove.addEventListener("click", function () {
        markCompoundFilterVisualDirty(builder);
        removeCompoundFilterRow(builder, row);
      });
    }
  }

  function markCompoundFilterVisualDirty(builder) {
    builder.__cfFrappeCompoundFilterSource = "visual";
  }

  function addCompoundFilterRow(builder, group) {
    var container = compoundFilterItemsContainer(group || builder.querySelector("[data-cf-frappe-filter-group]"));
    var row = cloneCompoundFilterTemplate(builder, "[data-cf-frappe-filter-row-template]");
    if (!container || !row) {
      return;
    }
    resetCompoundFilterRow(row);
    container.appendChild(row);
    refreshCompoundFilterOperatorOptions(builder, row);
    refreshCompoundFilterValueInputType(builder, row);
    markCompoundFilterVisualDirty(builder);
    hydrateCompoundFilterRow(builder, row);
  }

  function addCompoundFilterGroup(builder, group) {
    var container = compoundFilterItemsContainer(group);
    var childGroup = cloneCompoundFilterTemplate(builder, "[data-cf-frappe-filter-group-template]");
    if (!container || !childGroup) {
      return;
    }
    resetCompoundFilterGroup(builder, childGroup);
    container.appendChild(childGroup);
    markCompoundFilterVisualDirty(builder);
    hydrateCompoundFilterGroup(builder, childGroup);
  }

  function cloneCompoundFilterTemplate(builder, selector) {
    var template = builder.querySelector(selector);
    var content = template && template.content;
    var element = content && content.firstElementChild;
    if (!element || typeof element.cloneNode !== "function") {
      return null;
    }
    return element.cloneNode(true);
  }

  function resetCompoundFilterGroup(builder, group) {
    var match = group.querySelector("[data-cf-frappe-filter-match]");
    if (match) {
      match.value = "all";
    }
    var container = compoundFilterItemsContainer(group);
    var row = cloneCompoundFilterTemplate(builder, "[data-cf-frappe-filter-row-template]");
    if (!container || !row) {
      return;
    }
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    resetCompoundFilterRow(row);
    container.appendChild(row);
  }

  function resetCompoundFilterRow(row) {
    Array.prototype.forEach.call(row.querySelectorAll("select, input"), function (control) {
      control.value = "";
    });
    var operator = row.querySelector("[data-cf-frappe-filter-operator]");
    if (operator) {
      operator.value = "eq";
    }
  }

  function removeCompoundFilterRow(builder, row) {
    var group = compoundFilterClosestGroup(row);
    var container = compoundFilterItemsContainer(group);
    if (compoundFilterContainerChildren(container).length <= 1) {
      resetCompoundFilterRow(row);
      refreshCompoundFilterOperatorOptions(builder, row);
      refreshCompoundFilterValueInputType(builder, row);
      return;
    }
    if (typeof row.remove === "function") {
      row.remove();
    }
  }

  function removeCompoundFilterGroup(builder, group) {
    if (group === builder.querySelector("[data-cf-frappe-filter-group]")) {
      return;
    }
    var parent = compoundFilterParentGroup(group);
    if (typeof group.remove === "function") {
      group.remove();
    }
    ensureCompoundFilterGroupHasItem(builder, parent);
  }

  function ensureCompoundFilterGroupHasItem(builder, group) {
    var container = compoundFilterItemsContainer(group);
    if (!container || compoundFilterContainerChildren(container).length > 0) {
      return;
    }
    var row = cloneCompoundFilterTemplate(builder, "[data-cf-frappe-filter-row-template]");
    if (!row) {
      return;
    }
    resetCompoundFilterRow(row);
    container.appendChild(row);
    hydrateCompoundFilterRow(builder, row);
  }

  function syncCompoundFilterExpression(builder) {
    var target = builder.querySelector('[name="filter_expression"]');
    if (!target) {
      return;
    }
    if (builder.__cfFrappeCompoundFilterSource === "visual") {
      var expression = compoundFilterExpressionFromBuilder(builder);
      target.value = expression ? JSON.stringify(expression) : "";
    }
  }

  function compoundFilterExpressionFromBuilder(builder) {
    var root = builder.querySelector("[data-cf-frappe-filter-group]");
    if (root) {
      return compoundFilterExpressionFromGroup(builder, root, true);
    }
    var filters = [];
    Array.prototype.forEach.call(builder.querySelectorAll("[data-cf-frappe-filter-row]"), function (row) {
      var filter = compoundFilterExpressionFromRow(builder, row);
      if (filter) {
        filters.push(filter);
      }
    });
    if (filters.length === 0) {
      return undefined;
    }
    if (filters.length === 1) {
      return filters[0];
    }
    var match = controlValue(builder.querySelector("[data-cf-frappe-filter-match]")) === "any" ? "any" : "all";
    return {
      kind: "group",
      match: match,
      filters: filters
    };
  }

  function compoundFilterExpressionFromGroup(builder, group, root) {
    var filters = [];
    var container = compoundFilterItemsContainer(group);
    compoundFilterContainerChildren(container).forEach(function (item) {
      var filter = undefined;
      if (compoundFilterElementMatches(item, "[data-cf-frappe-filter-row]")) {
        filter = compoundFilterExpressionFromRow(builder, item);
      } else if (compoundFilterElementMatches(item, "[data-cf-frappe-filter-group]")) {
        filter = compoundFilterExpressionFromGroup(builder, item, false);
      }
      if (filter) {
        filters.push(filter);
      }
    });
    if (filters.length === 0) {
      return undefined;
    }
    if (root && filters.length === 1) {
      return filters[0];
    }
    var match = controlValue(group.querySelector("[data-cf-frappe-filter-match]")) === "any" ? "any" : "all";
    return {
      kind: "group",
      match: match,
      filters: filters
    };
  }

  function compoundFilterItemsContainer(group) {
    return group && typeof group.querySelector === "function"
      ? group.querySelector("[data-cf-frappe-filter-items]") || group.querySelector("[data-cf-frappe-filter-rows]")
      : null;
  }

  function compoundFilterContainerChildren(container) {
    return container && container.children ? Array.prototype.slice.call(container.children) : [];
  }

  function compoundFilterClosestGroup(element) {
    return element && typeof element.closest === "function" ? element.closest("[data-cf-frappe-filter-group]") : null;
  }

  function compoundFilterParentGroup(group) {
    var parent = group && group.parentElement;
    return parent && typeof parent.closest === "function" ? parent.closest("[data-cf-frappe-filter-group]") : null;
  }

  function compoundFilterElementMatches(element, selector) {
    return element && typeof element.matches === "function" ? element.matches(selector) : false;
  }

  function compoundFilterExpressionFromRow(builder, row) {
    var field = controlValue(row.querySelector("[data-cf-frappe-filter-field]"));
    var value = controlValue(row.querySelector("[data-cf-frappe-filter-value]"));
    if (!field || value === "") {
      return undefined;
    }
    if (compoundFilterExpressionKind(builder) === "report") {
      return {
        filter: field,
        value: value
      };
    }
    var operator = controlValue(row.querySelector("[data-cf-frappe-filter-operator]")) || "eq";
    return Object.assign(
      {
        field: field,
        value: compoundFilterValue(value, operator)
      },
      operator === "eq" ? {} : { operator: operator }
    );
  }

  function compoundFilterValue(value, operator) {
    if (operator === "in" || operator === "not_in" || operator === "between" || operator === "not_between") {
      return value.split(",").map(function (item) {
        return item.trim();
      }).filter(function (item) {
        return item !== "";
      });
    }
    return value;
  }

  function refreshCompoundFilterOperatorOptions(builder, row) {
    var field = controlValue(row.querySelector("[data-cf-frappe-filter-field]"));
    var operator = row.querySelector("[data-cf-frappe-filter-operator]");
    if (!operator || typeof document.createElement !== "function") {
      return;
    }
    var options = compoundFilterFieldOptions(builder, field);
    var selected = operator.value;
    while (operator.firstChild) {
      operator.removeChild(operator.firstChild);
    }
    options.forEach(function (option) {
      var element = document.createElement("option");
      element.value = option.operator;
      element.textContent = option.label;
      if (option.operator === selected) {
        element.selected = true;
      }
      operator.appendChild(element);
    });
    if (!options.some(function (option) { return option.operator === operator.value; }) && options[0]) {
      operator.value = options[0].operator;
    }
  }

  function refreshCompoundFilterValueInputType(builder, row) {
    var value = row.querySelector("[data-cf-frappe-filter-value]");
    if (!value) {
      return;
    }
    value.type = compoundFilterValueInputType(builder, row);
  }

  function compoundFilterValueInputType(builder, row) {
    var operator = controlValue(row.querySelector("[data-cf-frappe-filter-operator]")) || "eq";
    if (operator === "in" || operator === "not_in" || operator === "between" || operator === "not_between") {
      return "text";
    }
    var field = controlValue(row.querySelector("[data-cf-frappe-filter-field]"));
    var metadata = compoundFilterMetadata(builder).filter(function (item) {
      return item && item.field === field;
    })[0];
    var inputType = metadata && metadata.inputType;
    return inputType === "number" || inputType === "date" || inputType === "datetime-local" ? inputType : "text";
  }

  function compoundFilterFieldOptions(builder, field) {
    var metadata = compoundFilterMetadata(builder);
    var selected = metadata.filter(function (item) {
      return item && item.field === field;
    })[0];
    if (selected && Array.isArray(selected.operators)) {
      return selected.operators;
    }
    return metadata.reduce(function (operators, item) {
      (item && Array.isArray(item.operators) ? item.operators : []).forEach(function (operator) {
        if (!operators.some(function (existing) { return existing.operator === operator.operator; })) {
          operators.push(operator);
        }
      });
      return operators;
    }, []);
  }

  function compoundFilterMetadata(builder) {
    if (builder.__cfFrappeFilterFields) {
      return builder.__cfFrappeFilterFields;
    }
    try {
      builder.__cfFrappeFilterFields = JSON.parse((builder.dataset && builder.dataset.filterFields) || "[]");
    } catch (_error) {
      builder.__cfFrappeFilterFields = [];
    }
    return builder.__cfFrappeFilterFields;
  }

  function compoundFilterExpressionKind(builder) {
    return builder && builder.dataset && builder.dataset.filterExpressionKind === "report" ? "report" : "list";
  }

  function controlValue(control) {
    return control && control.value !== undefined ? String(control.value).trim() : "";
  }

  function hydrateReportFormulaBuilders() {
    var builders = document.querySelectorAll("[data-cf-frappe-report-formula-builder]");
    if (!builders || builders.length === 0) {
      return;
    }
    Array.prototype.forEach.call(builders, hydrateReportFormulaBuilder);
  }

  function hydrateReportFormulaBuilder(builder) {
    if (!builder || builder.__cfFrappeReportFormulaHydrated) {
      return;
    }
    builder.__cfFrappeReportFormulaHydrated = true;
    Array.prototype.forEach.call(builder.querySelectorAll("[data-cf-frappe-formula-operand]"), function (operand) {
      hydrateReportFormulaOperand(builder, operand);
    });
  }

  function hydrateReportFormulaOperand(builder, operand) {
    if (!operand || operand.__cfFrappeReportFormulaOperandHydrated) {
      return;
    }
    operand.__cfFrappeReportFormulaOperandHydrated = true;
    var kind = operand.querySelector("[data-cf-frappe-formula-kind]");
    if (kind) {
      kind.addEventListener("change", function () {
        syncReportFormulaNestedOperand(builder, operand);
      });
    }
  }

  function syncReportFormulaNestedOperand(builder, operand) {
    var nested = operand.querySelector("[data-cf-frappe-formula-nested]");
    if (!nested) {
      return;
    }
    var kind = controlValue(operand.querySelector("[data-cf-frappe-formula-kind]"));
    if (kind !== "nested") {
      clearReportFormulaNested(nested);
      return;
    }
    if (nested.firstChild) {
      return;
    }
    var group = createReportFormulaNestedGroup(builder, operand);
    if (!group) {
      return;
    }
    nested.appendChild(group);
    Array.prototype.forEach.call(group.querySelectorAll("[data-cf-frappe-formula-operand]"), function (childOperand) {
      hydrateReportFormulaOperand(builder, childOperand);
    });
  }

  function clearReportFormulaNested(nested) {
    while (nested.firstChild) {
      nested.removeChild(nested.firstChild);
    }
  }

  function createReportFormulaNestedGroup(builder, operand) {
    if (typeof document.createElement !== "function") {
      return null;
    }
    var prefix = reportFormulaOperandPrefix(operand);
    var label = reportFormulaOperandLabel(operand);
    var depth = reportFormulaOperandDepth(operand);
    if (!prefix || !label || depth > reportFormulaMaxDepth(builder)) {
      return null;
    }
    var group = document.createElement("div");
    group.className = "report-formula-nested-group";
    group.appendChild(createReportFormulaOperatorControl(prefix, label));
    group.appendChild(createReportFormulaOperand(builder, prefix + "Left", label + " Left", depth + 1));
    group.appendChild(createReportFormulaOperand(builder, prefix + "Right", label + " Right", depth + 1));
    return group;
  }

  function createReportFormulaOperand(builder, prefix, label, depth) {
    var operand = document.createElement("div");
    operand.className = "report-formula-operand";
    operand.setAttribute("data-cf-frappe-formula-operand", "");
    operand.dataset.formulaPrefix = prefix;
    operand.dataset.formulaLabel = label;
    operand.dataset.formulaDepth = String(depth);
    operand.appendChild(createReportFormulaKindControl(builder, prefix, label, depth));
    operand.appendChild(createReportFormulaFieldControl(builder, prefix, label));
    operand.appendChild(createReportFormulaLiteralControl(prefix, label));
    var nested = document.createElement("div");
    nested.className = "report-formula-nested";
    nested.setAttribute("data-cf-frappe-formula-nested", "");
    operand.appendChild(nested);
    return operand;
  }

  function createReportFormulaKindControl(builder, prefix, label, depth) {
    var select = document.createElement("select");
    setReportFormulaControlName(select, prefix + "Kind");
    select.setAttribute("data-cf-frappe-formula-kind", "");
    appendReportFormulaOption(select, "field", "Field");
    appendReportFormulaOption(select, "literal", "Number");
    if (depth <= reportFormulaMaxDepth(builder)) {
      appendReportFormulaOption(select, "nested", "Nested formula");
    }
    return reportFormulaField(label + " Type", select);
  }

  function createReportFormulaFieldControl(builder, prefix, label) {
    var select = document.createElement("select");
    setReportFormulaControlName(select, prefix);
    appendReportFormulaOption(select, "", "");
    reportFormulaFields(builder).forEach(function (field) {
      appendReportFormulaOption(select, field.name, field.label || field.name);
    });
    return reportFormulaField(label, select);
  }

  function createReportFormulaLiteralControl(prefix, label) {
    var input = document.createElement("input");
    setReportFormulaControlName(input, prefix + "Literal");
    input.type = "number";
    input.step = "any";
    return reportFormulaField(label + " Number", input);
  }

  function createReportFormulaOperatorControl(prefix, label) {
    var select = document.createElement("select");
    setReportFormulaControlName(select, prefix + "Operator");
    appendReportFormulaOption(select, "", "");
    appendReportFormulaOption(select, "add", "Add");
    appendReportFormulaOption(select, "subtract", "Subtract");
    appendReportFormulaOption(select, "multiply", "Multiply");
    appendReportFormulaOption(select, "divide", "Divide");
    return reportFormulaField(label + " Operator", select);
  }

  function reportFormulaField(label, control) {
    var field = document.createElement("label");
    field.className = "field";
    var span = document.createElement("span");
    span.textContent = label;
    field.appendChild(span);
    field.appendChild(control);
    return field;
  }

  function setReportFormulaControlName(control, name) {
    control.name = name;
    if (typeof control.setAttribute === "function") {
      control.setAttribute("name", name);
    }
  }

  function appendReportFormulaOption(select, value, label) {
    var option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  function reportFormulaFields(builder) {
    if (builder.__cfFrappeReportFormulaFields) {
      return builder.__cfFrappeReportFormulaFields;
    }
    try {
      var parsed = JSON.parse((builder.dataset && builder.dataset.formulaFields) || "[]");
      builder.__cfFrappeReportFormulaFields = Array.isArray(parsed)
        ? parsed.filter(function (field) {
            return field && typeof field.name === "string";
          }).map(function (field) {
            return {
              name: field.name,
              label: typeof field.label === "string" ? field.label : field.name
            };
          })
        : [];
    } catch (_error) {
      builder.__cfFrappeReportFormulaFields = [];
    }
    return builder.__cfFrappeReportFormulaFields;
  }

  function reportFormulaMaxDepth(builder) {
    var value = Number(builder.dataset && builder.dataset.formulaMaxDepth);
    return Number.isFinite(value) && value > 0 ? value : 16;
  }

  function reportFormulaOperandPrefix(operand) {
    return operand.dataset && operand.dataset.formulaPrefix ? String(operand.dataset.formulaPrefix) : "";
  }

  function reportFormulaOperandLabel(operand) {
    return operand.dataset && operand.dataset.formulaLabel ? String(operand.dataset.formulaLabel) : "";
  }

  function reportFormulaOperandDepth(operand) {
    var value = Number(operand.dataset && operand.dataset.formulaDepth);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  var formHandlers = {};
  var formBinding;

  function registerFormHandlers(doctype, handlers) {
    var registered = formHandlers[doctype] || [];
    registered.push(handlers || {});
    formHandlers[doctype] = registered;
    ready(function () {
      var binding = currentFormBinding();
      if (binding && binding.context.doctype === doctype) {
        triggerFormHandler(binding, handlers || {}, "setup");
        triggerFormHandler(binding, handlers || {}, "onload");
        triggerFormHandler(binding, handlers || {}, "refresh");
      }
    });
  }

  function currentFormBinding() {
    var pageContext = context();
    if (pageContext.scope !== "form" || !pageContext.doctype) {
      return null;
    }
    var form = document.querySelector("form.form");
    if (!form) {
      return null;
    }
    if (!formBinding || formBinding.form !== form) {
      formBinding = createFormBinding(pageContext, form);
    }
    return formBinding;
  }

  function createFormBinding(pageContext, form) {
    var baseDoc = readFormData(form);
    var binding = {
      baseDoc: cloneMergeValue(baseDoc),
      baseDocstatus: pageContext.documentStatus,
      baseVersion: pageContext.documentVersion === undefined ? formExpectedVersion(form) : pageContext.documentVersion,
      context: pageContext,
      dirty: false,
      doc: baseDoc,
      form: form,
      submitting: false,
      validated: true
    };
    binding.frm = createFrm(binding);
    attachFieldListeners(binding);
    attachDocumentCollaboration(binding);
    form.addEventListener("submit", function (event) {
      if (binding.submitting) {
        return;
      }
      if (!isSaveSubmit(event)) {
        return;
      }
      if (!validateFormForSave(binding)) {
        event.preventDefault();
      }
    });
    return binding;
  }

  function createFrm(binding) {
    var frm = {
      doc: binding.doc,
      docname: binding.context.documentName,
      doctype: binding.context.doctype,
      validated: true,
      dirty: function () {
        binding.dirty = true;
        binding.form.dataset.dirty = "1";
      },
      get_value: function (fieldname) {
        syncFormData(binding);
        return docValue(binding.doc, fieldname);
      },
      clear_value: function (fieldname) {
        return frm.set_value(fieldname, null);
      },
      get_field: function (fieldname) {
        var fields = fieldsNamed(binding.form, fieldname);
        return fields.length > 0 ? fields[0] : null;
      },
      is_dirty: function () {
        return binding.dirty;
      },
      is_new: function () {
        return !binding.context.documentName;
      },
      refresh: function () {
        return triggerFormEvent(binding, "refresh");
      },
      refresh_field: function (fieldname) {
        setFieldValue(binding.form, fieldname, docValue(binding.doc, fieldname));
      },
      save: function (options) {
        if (options && options.merge) {
          return mergeSaveForm(binding);
        }
        return submitNativeForm(binding);
      },
      set_value: function (fieldname, value) {
        setFieldValue(binding.form, fieldname, value);
        syncFormData(binding);
        frm.dirty();
        triggerFormEvent(binding, fieldname);
        return Promise.resolve(value);
      },
      set_df_property: function (fieldname, property, value) {
        setFieldProperty(binding.form, fieldname, property, value);
        return frm;
      },
      toggle_display: function (fieldname, show) {
        setFieldProperty(binding.form, fieldname, "hidden", !show);
        return frm;
      },
      toggle_enable: function (fieldname, enable) {
        setFieldProperty(binding.form, fieldname, "disabled", !enable);
        return frm;
      },
      trigger: function (eventName) {
        return triggerFormEvent(binding, eventName);
      },
      mergePlan: function (remote, draft) {
        return currentFormMergePlan(binding, remote, draft);
      },
      merge_save: function () {
        return mergeSaveForm(binding);
      },
      share_draft: function (input) {
        return sendFormSharedDraft(binding, input);
      }
    };
    return frm;
  }

  function validateFormForSave(binding) {
    syncFormData(binding);
    binding.validated = true;
    binding.frm.validated = true;
    var valid = triggerFormEvent(binding, "validate") !== false &&
      binding.frm.validated !== false &&
      binding.validated !== false;
    var beforeSave = valid ? triggerFormEvent(binding, "before_save") !== false : false;
    return valid && beforeSave && binding.frm.validated !== false && binding.validated !== false;
  }

  function submitNativeForm(binding) {
    if (!validateFormForSave(binding)) {
      return false;
    }
    binding.submitting = true;
    if (typeof binding.form.requestSubmit === "function") {
      binding.form.requestSubmit();
    } else if (typeof binding.form.submit === "function") {
      binding.form.submit();
    }
    binding.submitting = false;
    return true;
  }

  function mergeSaveForm(binding) {
    if (binding.submitting) {
      return Promise.resolve(false);
    }
    if (!binding.context.doctype || !binding.context.documentName || binding.baseVersion === undefined) {
      return Promise.reject(new Error("Merge save requires an existing document"));
    }
    if (!validateFormForSave(binding)) {
      return Promise.resolve(false);
    }
    var plan = currentFormLocalChangePlan(binding);
    var input = {
      baseVersion: binding.baseVersion,
      patch: plan.patch
    };
    if (plan.unset.length > 0) {
      input.unset = plan.unset;
    }
    binding.submitting = true;
    return request(resourcePath(binding.context.doctype, binding.context.documentName) + "/merge", {
      method: "POST",
      body: input
    })
      .then(unwrapData)
      .then(function (result) {
        applyMergeSaveResult(binding, result);
        return result;
      })
      .finally(function () {
        binding.submitting = false;
      });
  }

  function attachFieldListeners(binding) {
    Array.prototype.forEach.call(binding.form.querySelectorAll("[name]"), function (field) {
      var fieldname = field.name;
      field.addEventListener("focus", function () {
        sendFormFieldEdit(binding, field, true);
      });
      field.addEventListener("change", function () {
        if (restoreLockedFieldValue(field)) {
          return;
        }
        syncFormData(binding);
        binding.frm.dirty();
        triggerFormEvent(binding, fieldname);
        sendFormFieldEdit(binding, field, true);
      });
      field.addEventListener("input", function () {
        if (restoreLockedFieldValue(field)) {
          return;
        }
        syncFormData(binding);
        binding.frm.dirty();
        sendFormFieldEdit(binding, field, true);
      });
      field.addEventListener("blur", function () {
        sendFormFieldEdit(binding, field, false);
      });
    });
  }

  function attachDocumentCollaboration(binding) {
    var pageContext = binding.context;
    if (!pageContext.documentName || !pageContext.tenantId || !pageContext.realtimeRoute) {
      return;
    }
    try {
      binding.collaborationSubscription = realtimeSubscribe(
        documentTopicFromOptions(pageContext.doctype, pageContext.documentName, {
          tenantId: pageContext.tenantId,
          realtimeRoute: pageContext.realtimeRoute
        }),
        {},
        { tenantId: pageContext.tenantId, realtimeRoute: pageContext.realtimeRoute }
      );
    } catch (_error) {
      binding.collaborationSubscription = undefined;
    }
  }

  function sendFormFieldEdit(binding, field, editing) {
    if (!binding.collaborationSubscription || isInternalFormField(field.name)) {
      return;
    }
    binding.collaborationSubscription.sendFieldEdit(field.name, { editing: editing });
  }

  function sendFormSharedDraft(binding, input) {
    var messageInput = isPlainObject(input) ? input : {};
    if (!Object.prototype.hasOwnProperty.call(messageInput, "patch")) {
      var plan = currentFormLocalChangePlan(binding);
      messageInput = Object.assign({
        baseVersion: binding.baseVersion,
        patch: plan.patch
      }, plan.unset.length > 0 ? { unset: plan.unset } : {}, messageInput);
    }
    messageInput = withoutUnsetPatchFields(messageInput);
    if (!hasSharedDraftChanges(messageInput)) {
      return realtimeSharedDraftMessage(messageInput);
    }
    if (!binding.collaborationSubscription || typeof binding.collaborationSubscription.sendSharedDraft !== "function") {
      return realtimeSharedDraftMessage(messageInput);
    }
    return binding.collaborationSubscription.sendSharedDraft(messageInput);
  }

  function hasSharedDraftChanges(input) {
    return (isPlainObject(input && input.patch) && Object.keys(input.patch).length > 0) ||
      (Array.isArray(input && input.unset) && input.unset.length > 0);
  }

  function withoutUnsetPatchFields(input) {
    if (!isPlainObject(input && input.patch) || !Array.isArray(input && input.unset)) {
      return input;
    }
    var unset = input.unset.map(function (field) {
      return String(field || "").trim();
    });
    var patch = Object.assign({}, input.patch);
    unset.forEach(function (field) {
      delete patch[field];
    });
    return Object.assign({}, input, { patch: patch });
  }

  function readFormData(form) {
    var doc = {};
    Array.prototype.forEach.call(form.querySelectorAll("[name]"), function (field) {
      if (!isInternalFormField(field.name)) {
        setDocValue(doc, field.name, fieldValue(field));
      }
    });
    return doc;
  }

  function syncFormData(binding) {
    binding.doc = readFormData(binding.form);
    binding.frm.doc = binding.doc;
  }

  function formExpectedVersion(form) {
    var fields = fieldsNamed(form, "expectedVersion");
    if (fields.length === 0) {
      return 0;
    }
    var value = Number(fields[0].value);
    return Number.isInteger(value) && value >= 0 ? value : 0;
  }

  function fieldValue(field) {
    var fieldType = field.dataset && field.dataset.cfFrappeFieldType;
    if (field.type === "checkbox") {
      return Boolean(field.checked);
    }
    if (fieldType && field.value === "" && !field.required) {
      return undefined;
    }
    if (fieldType === "integer") {
      var integerValue = Number(field.value);
      return Number.isInteger(integerValue) ? integerValue : field.value;
    }
    if (fieldType === "number") {
      var numberValue = Number(field.value);
      return Number.isFinite(numberValue) ? numberValue : field.value;
    }
    if (fieldType === "boolean") {
      return field.value === "on" || field.value === "true";
    }
    if (fieldType === "json") {
      try {
        return JSON.parse(field.value);
      } catch (_error) {
        return field.value;
      }
    }
    return field.value;
  }

  function setFieldValue(form, fieldname, value) {
    Array.prototype.forEach.call(fieldsNamed(form, fieldname), function (field) {
      setControlValue(field, value);
      rememberLockedFieldValue(field);
    });
  }

  function fieldsNamed(form, fieldname) {
    var fields = [];
    Array.prototype.forEach.call(form.querySelectorAll("[name]"), function (field) {
      if (field.name === fieldname) {
        fields.push(field);
      }
    });
    return fields;
  }

  function setFieldProperty(form, fieldname, property, value) {
    Array.prototype.forEach.call(fieldsNamed(form, fieldname), function (field) {
      if (property === "hidden") {
        setFieldHidden(field, Boolean(value));
        return;
      }
      if (property === "display") {
        setFieldHidden(field, !value);
        return;
      }
      if (property === "read_only" || property === "readOnly") {
        setFieldReadOnly(field, Boolean(value));
        return;
      }
      if (property === "disabled") {
        setFieldSoftDisabled(field, Boolean(value));
        return;
      }
      if (property === "reqd" || property === "required") {
        field.required = Boolean(value);
        return;
      }
      field[property] = value;
    });
  }

  function setControlValue(field, value) {
    if (field.type === "checkbox") {
      field.checked = Boolean(value);
    } else if (field.dataset && field.dataset.cfFrappeFieldType === "json" && value !== null && typeof value === "object") {
      field.value = JSON.stringify(value);
    } else {
      field.value = value == null ? "" : String(value);
    }
  }

  function fieldWrapper(field) {
    if (typeof field.closest === "function") {
      return field.closest(".field") || field;
    }
    return field;
  }

  function setFieldHidden(field, hidden) {
    field.hidden = hidden;
    fieldWrapper(field).hidden = hidden;
  }

  function setFieldReadOnly(field, readOnly) {
    field[readOnlyProperty] = readOnly;
    field.readOnly = readOnly;
    setBooleanAttribute(field, "aria-readonly", readOnly);
    if (readOnly) {
      rememberLockedFieldValue(field, true);
    } else {
      delete field[readOnlyProperty];
      clearLockedFieldValueIfUnlocked(field);
    }
  }

  function setFieldSoftDisabled(field, disabled) {
    field[softDisabledProperty] = disabled;
    setBooleanAttribute(field, "aria-disabled", disabled);
    if (disabled) {
      rememberLockedFieldValue(field, true);
    } else {
      delete field[softDisabledProperty];
      clearLockedFieldValueIfUnlocked(field);
    }
  }

  function setBooleanAttribute(field, name, value) {
    if (typeof field.setAttribute === "function" && typeof field.removeAttribute === "function") {
      if (value) {
        field.setAttribute(name, "true");
      } else {
        field.removeAttribute(name);
      }
    }
  }

  function fieldInteractionLocked(field) {
    return Boolean(field[readOnlyProperty] || field[softDisabledProperty]);
  }

  function rememberLockedFieldValue(field, force) {
    if (force || fieldInteractionLocked(field)) {
      field[lockedValueProperty] = fieldValue(field);
    }
  }

  function restoreLockedFieldValue(field) {
    if (!fieldInteractionLocked(field)) {
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(field, lockedValueProperty)) {
      setControlValue(field, field[lockedValueProperty]);
    }
    return true;
  }

  function clearLockedFieldValueIfUnlocked(field) {
    if (!fieldInteractionLocked(field)) {
      delete field[lockedValueProperty];
    }
  }

  function setDocValue(doc, fieldname, value) {
    var child = childFieldPath(fieldname);
    if (child) {
      var rows = Array.isArray(doc[child.table]) ? doc[child.table] : [];
      rows[child.index] = Object.assign({}, rows[child.index] || {}, { [child.field]: value });
      doc[child.table] = rows;
      return;
    }
    doc[fieldname] = value;
  }

  function docValue(doc, fieldname) {
    if (Object.prototype.hasOwnProperty.call(doc, fieldname)) {
      return doc[fieldname];
    }
    var child = childFieldPath(fieldname);
    if (!child || !Array.isArray(doc[child.table])) {
      return undefined;
    }
    return doc[child.table][child.index] && doc[child.table][child.index][child.field];
  }

  function childFieldPath(fieldname) {
    var match = /^([^.[\\]]+)\\[(\\d+)\\]\\.(.+)$/.exec(fieldname);
    if (!match) {
      return null;
    }
    return {
      field: match[3],
      index: Number(match[2]),
      table: match[1]
    };
  }

  function isInternalFormField(fieldname) {
    var child = childFieldPath(fieldname);
    return fieldname === "expectedVersion" || fieldname === childRowIndexField || (child && child.field === childRowIndexField);
  }

  function formFieldNames(form) {
    var names = [];
    var seen = {};
    Array.prototype.forEach.call(form.querySelectorAll("[name]"), function (field) {
      var fieldname = String(field.name || "").trim();
      var child = childFieldPath(fieldname);
      var mergeField = child ? child.table : fieldname;
      if (!mergeField || isInternalFormField(fieldname) || seen[mergeField]) {
        return;
      }
      seen[mergeField] = true;
      names.push(mergeField);
    });
    return names;
  }

  function currentFormMergePlan(binding, remote, draft) {
    syncFormData(binding);
    var remoteSnapshot = remote || binding.remoteSnapshot || {
      version: binding.baseVersion,
      data: binding.baseDoc
    };
    var baseSnapshot = formBaseSnapshot(binding);
    return documentMergePlan(
      baseSnapshot,
      remoteSnapshot,
      draft || binding.doc,
      { fields: formFieldNames(binding.form) }
    );
  }

  function currentFormLocalChangePlan(binding) {
    syncFormData(binding);
    var baseSnapshot = formBaseSnapshot(binding);
    return documentMergePlan(
      baseSnapshot,
      baseSnapshot,
      binding.doc,
      { fields: formFieldNames(binding.form) }
    );
  }

  function formBaseSnapshot(binding) {
    return Object.assign({
      version: binding.baseVersion,
      data: binding.baseDoc
    }, binding.baseDocstatus === undefined ? {} : { docstatus: binding.baseDocstatus });
  }

  function applyMergeSaveResult(binding, result) {
    binding.frm.last_merge_result = result;
    if (result && result.plan) {
      binding.remoteMergePlan = result.plan;
      binding.frm.remote_merge_plan = result.plan;
      binding.form.dataset.remoteMergeState = result.plan.status;
    }
    if (result && result.document) {
      binding.remoteSnapshot = result.document;
    }
    if (result && (result.status === "applied" || result.status === "noop") && result.document) {
      applyDocumentSnapshotToForm(binding, result.document);
    }
  }

  function applyDocumentSnapshotToForm(binding, snapshot) {
    if (!snapshot || !isPlainObject(snapshot.data)) {
      return;
    }
    binding.baseDoc = cloneMergeValue(snapshot.data);
    binding.baseDocstatus = snapshot.docstatus;
    if (typeof snapshot.version === "number") {
      binding.baseVersion = snapshot.version;
      binding.context.documentVersion = snapshot.version;
      binding.form.dataset.documentVersion = String(snapshot.version);
    }
    binding.doc = cloneMergeValue(snapshot.data);
    binding.frm.doc = binding.doc;
    writeDocumentToForm(binding, binding.doc);
    binding.dirty = false;
    delete binding.form.dataset.dirty;
    delete binding.form.dataset.remoteUpdate;
    delete binding.remoteSnapshot;
    delete binding.remoteMergePlan;
    delete binding.frm.remote_merge_plan;
    binding.form.dataset.remoteMergeState = "clean";
  }

  function writeDocumentToForm(binding, data) {
    Array.prototype.forEach.call(binding.form.querySelectorAll("[name]"), function (field) {
      if (field.name === "expectedVersion") {
        setControlValue(field, binding.baseVersion);
        rememberLockedFieldValue(field);
        return;
      }
      if (isInternalFormField(field.name)) {
        return;
      }
      setControlValue(field, docValue(data, field.name));
      rememberLockedFieldValue(field);
    });
  }

  function isSaveSubmit(event) {
    var submitter = event && event.submitter;
    return !(submitter && typeof submitter.getAttribute === "function" && submitter.getAttribute("formaction") !== null);
  }

  function triggerFormEvent(binding, eventName) {
    var ok = true;
    (formHandlers[binding.context.doctype] || []).forEach(function (handlers) {
      if (triggerFormHandler(binding, handlers, eventName) === false) {
        ok = false;
      }
    });
    return ok;
  }

  function triggerFormHandler(binding, handlers, eventName) {
    var handler = handlers && handlers[eventName];
    if (typeof handler !== "function") {
      return undefined;
    }
    binding.validated = binding.frm.validated;
    var result = handler(binding.frm);
    binding.validated = binding.frm.validated;
    return result;
  }

  function realtimeRouteFromOptions(options) {
    var route = (options && options.realtimeRoute) || context().realtimeRoute || "/api/realtime";
    if (route.charAt(0) !== "/") {
      route = "/" + route;
    }
    return route.length > 1 ? route.replace(/\\/$/, "") : route;
  }

  function realtimeUrl(topic, options) {
    var url = new URL(realtimeRouteFromOptions(options), root.location.href);
    url.searchParams.set("topic", topic);
    if (options && options.replayAfter !== undefined && options.replayAfter !== null) {
      url.searchParams.set("replayAfter", String(options.replayAfter));
    }
    if (options && options.replayLimit !== undefined && options.replayLimit !== null) {
      url.searchParams.set("replayLimit", String(options.replayLimit));
    }
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url;
  }

  function realtimePresenceUrl(topic, options) {
    return withQuery(realtimeRouteFromOptions(options) + "/presence", { topic: topic });
  }

  function realtimePresence(topic, options) {
    return request(realtimePresenceUrl(topic, options)).then(unwrapData);
  }

  function realtimePresenceDocument(doctype, name, options) {
    return realtimePresence(documentTopicFromOptions(doctype, name, options), options);
  }

  function realtimeSubscribe(topic, handlers, options) {
    var url = realtimeUrl(topic, options).toString();
    var socket = new WebSocket(url, options && options.protocols);
    var subscription = {
      close: function (code, reason) {
        socket.close(code, reason);
      },
      send: function (message) {
        socket.send(typeof message === "string" ? message : JSON.stringify(message));
        return message;
      },
      sendFieldEdit: function (field, input) {
        return realtimeSendFieldEdit(socket, field, input);
      },
      sendSharedDraft: function (input) {
        return realtimeSendSharedDraft(socket, input);
      },
      socket: socket,
      topic: topic,
      url: url
    };
    var callbacks = handlers || {};
    addSocketListener(socket, "message", function (message) {
      handleRealtimeMessage(message, subscription, callbacks);
    });
    addSocketListener(socket, "open", function (event) {
      callRealtimeHandler(callbacks.open, [event, subscription]);
    });
    addSocketListener(socket, "close", function (event) {
      callRealtimeHandler(callbacks.close, [event, subscription]);
    });
    addSocketListener(socket, "error", function (event) {
      callRealtimeHandler(callbacks.error, [event, subscription]);
    });
    return subscription;
  }

  function handleRealtimeMessage(rawMessage, subscription, callbacks) {
    var raw = rawMessage && rawMessage.data;
    var parsed;
    try {
      parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (error) {
      callRealtimeHandler(callbacks.malformed, [error, raw, rawMessage, subscription]);
      return;
    }
    callRealtimeHandler(callbacks.message, [parsed, rawMessage, subscription]);
    if (!parsed || typeof parsed !== "object") {
      return;
    }
    if (parsed.type === "cf-frappe.realtime.connected") {
      callRealtimeHandler(callbacks.connected, [parsed, subscription]);
      return;
    }
    if (parsed.type === "cf-frappe.realtime.event" && parsed.event) {
      dispatchRealtimeEvent(parsed.event, parsed, subscription, callbacks);
      return;
    }
    if (parsed.type === realtimeCollaborationMessageType && parsed.event) {
      dispatchRealtimeCollaborationEvent(parsed.event, parsed, subscription, callbacks);
      return;
    }
    if (parsed.type === "cf-frappe.realtime.replay" && parsed.replay) {
      callRealtimeHandler(callbacks.replay, [parsed.replay, parsed, subscription]);
      var events = Array.isArray(parsed.replay.events) ? parsed.replay.events : [];
      events.forEach(function (entry) {
        if (entry && entry.event) {
          dispatchRealtimeEvent(entry.event, Object.assign({}, parsed, {
            type: "cf-frappe.realtime.event",
            cursor: entry.cursor,
            event: entry.event
          }), subscription, callbacks);
        }
      });
      return;
    }
    if (parsed.type === "cf-frappe.realtime.presence" && parsed.presence) {
      callRealtimeHandler(callbacks.presence, [parsed.presence, parsed, subscription]);
    }
  }

  function dispatchRealtimeEvent(event, message, subscription, callbacks) {
    callRealtimeHandler(callbacks.event, [event, message, subscription]);
    var payload = event && event.payload;
    if (payload && payload.kind === "DocumentUserNotification") {
      callRealtimeHandler(callbacks.notification, [payload, event, message, subscription]);
    }
  }

  function dispatchRealtimeCollaborationEvent(event, message, subscription, callbacks) {
    callRealtimeHandler(callbacks.collaboration, [event, message, subscription]);
    var payload = event && event.payload;
    if (payload && payload.kind === "DocumentFieldEditIntent") {
      callRealtimeHandler(callbacks.fieldEdit, [payload, event, message, subscription]);
    }
    if (payload && payload.kind === "DocumentSharedDraftPatch") {
      callRealtimeHandler(callbacks.sharedDraft, [payload, event, message, subscription]);
    }
  }

  function realtimeFieldEditMessage(field, input) {
    var options = isPlainObject(input) ? input : input === undefined ? {} : { value: input };
    var message = {
      type: fieldEditMessageType,
      field: String(field || "").trim(),
      editing: options.editing === false ? false : true
    };
    if (Object.prototype.hasOwnProperty.call(options, "value")) {
      message.value = options.value;
    }
    return message;
  }

  function realtimeSendFieldEdit(socket, field, input) {
    var message = realtimeFieldEditMessage(field, input);
    socket.send(JSON.stringify(message));
    return message;
  }

  function realtimeSharedDraftMessage(input) {
    var options = isPlainObject(input) ? input : {};
    var message = {
      type: sharedDraftMessageType
    };
    if (Number.isInteger(options.baseVersion) && options.baseVersion >= 0) {
      message.baseVersion = options.baseVersion;
    }
    if (isPlainObject(options.patch)) {
      message.patch = options.patch;
    }
    if (Array.isArray(options.unset)) {
      message.unset = options.unset;
    }
    return message;
  }

  function realtimeSendSharedDraft(socket, input) {
    var message = realtimeSharedDraftMessage(input);
    socket.send(JSON.stringify(message));
    return message;
  }

  function documentMergePlan(base, remote, draft, options) {
    var baseSnapshot = mergeSnapshot(base, 0);
    var remoteSnapshot = mergeSnapshot(remote, baseSnapshot.version);
    var draftData = isPlainObject(draft) ? draft : {};
    var fields = mergeFields(baseSnapshot.data, remoteSnapshot.data, draftData, options && options.fields);
    var localChangedFields = [];
    var remoteChangedFields = [];
    var mergedFields = [];
    var conflicts = [];
    var patch = {};
    var unset = [];
    if (baseSnapshot.docstatus !== undefined && remoteSnapshot.docstatus !== undefined && baseSnapshot.docstatus !== remoteSnapshot.docstatus) {
      conflicts.push(mergeConflict("docstatus", "remote_status_changed", {
        basePresent: true,
        localPresent: true,
        remotePresent: true,
        baseValue: baseSnapshot.docstatus,
        localValue: baseSnapshot.docstatus,
        remoteValue: remoteSnapshot.docstatus
      }));
    }
    fields.forEach(function (field) {
      var basePresent = Object.prototype.hasOwnProperty.call(baseSnapshot.data, field);
      var localPresent = Object.prototype.hasOwnProperty.call(draftData, field);
      var remotePresent = Object.prototype.hasOwnProperty.call(remoteSnapshot.data, field);
      var baseValue = baseSnapshot.data[field];
      var localValue = draftData[field];
      var remoteValue = remoteSnapshot.data[field];
      var localChanged = localPresent ? !mergeJsonEqual(localValue, baseValue) : basePresent;
      var remoteChanged = !mergeJsonEqual(remoteValue, baseValue);
      if (localChanged) {
        localChangedFields.push(field);
      }
      if (remoteChanged) {
        remoteChangedFields.push(field);
      }
      if (!localChanged) {
        return;
      }
      if (remoteChanged && !mergeJsonEqual(localValue, remoteValue)) {
        conflicts.push(mergeConflict(field, "remote_changed", {
          basePresent: basePresent,
          localPresent: localPresent,
          remotePresent: remotePresent,
          baseValue: baseValue,
          localValue: localValue,
          remoteValue: remoteValue
        }));
        return;
      }
      if (mergeJsonEqual(localValue, remoteValue)) {
        mergedFields.push(field);
        return;
      }
      mergedFields.push(field);
      if (localValue === undefined) {
        unset.push(field);
      } else {
        patch[field] = cloneMergeValue(localValue);
      }
    });
    return {
      status: conflicts.length === 0 ? "clean" : "conflict",
      baseVersion: baseSnapshot.version,
      remoteVersion: remoteSnapshot.version,
      localChangedFields: localChangedFields,
      remoteChangedFields: remoteChangedFields,
      mergedFields: mergedFields,
      patch: patch,
      unset: unset,
      conflicts: conflicts
    };
  }

  function mergeSnapshot(value, fallbackVersion) {
    var source = isPlainObject(value) ? value : {};
    var hasData = isPlainObject(source.data);
    var version = typeof source.version === "number" && Number.isFinite(source.version) ? source.version : fallbackVersion;
    return Object.assign({
      version: version,
      data: cloneMergeValue(hasData ? source.data : source)
    }, source.docstatus === undefined ? {} : { docstatus: source.docstatus });
  }

  function mergeFields(base, remote, draft, fields) {
    var input = Array.isArray(fields) ? fields : Object.keys(base).concat(Object.keys(remote), Object.keys(draft));
    var seen = {};
    var result = [];
    input.forEach(function (field) {
      var name = String(field || "").trim();
      if (!name || seen[name]) {
        return;
      }
      seen[name] = true;
      result.push(name);
    });
    return result;
  }

  function mergeConflict(field, reason, values) {
    var conflict = {
      field: field,
      reason: reason,
      basePresent: values.basePresent,
      localPresent: values.localPresent,
      remotePresent: values.remotePresent
    };
    if (values.baseValue !== undefined) {
      conflict.baseValue = cloneMergeValue(values.baseValue);
    }
    if (values.localValue !== undefined) {
      conflict.localValue = cloneMergeValue(values.localValue);
    }
    if (values.remoteValue !== undefined) {
      conflict.remoteValue = cloneMergeValue(values.remoteValue);
    }
    return conflict;
  }

  function mergeJsonEqual(left, right) {
    if (left === right) {
      return true;
    }
    if (left === undefined || right === undefined) {
      return false;
    }
    if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
      return false;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
        return false;
      }
      return left.every(function (item, index) {
        return mergeJsonEqual(item, right[index]);
      });
    }
    var leftKeys = Object.keys(left).sort();
    var rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every(function (key, index) {
      return key === rightKeys[index] && mergeJsonEqual(left[key], right[key]);
    });
  }

  function cloneMergeValue(value) {
    if (value === null || typeof value !== "object") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(cloneMergeValue);
    }
    var clone = {};
    Object.keys(value).forEach(function (key) {
      clone[key] = cloneMergeValue(value[key]);
    });
    return clone;
  }

  function addSocketListener(socket, type, listener) {
    if (typeof socket.addEventListener === "function") {
      socket.addEventListener(type, listener);
      return;
    }
    socket["on" + type] = listener;
  }

  function callRealtimeHandler(handler, args) {
    if (typeof handler === "function") {
      handler.apply(null, args);
    }
  }

  function hydratePresencePanels() {
    var panels = document.querySelectorAll('[data-cf-frappe-presence="document"]');
    if (!panels || panels.length === 0) {
      return;
    }
    Array.prototype.forEach.call(panels, hydratePresencePanel);
  }

  function hydratePresencePanel(panel) {
    var pageContext = context();
    var dataset = panel.dataset || {};
    var doctype = dataset.doctype || pageContext.doctype;
    var documentName = dataset.documentName || pageContext.documentName;
    var realtimeRoute = dataset.realtimeRoute || pageContext.realtimeRoute;
    var tenantId = dataset.tenantId || pageContext.tenantId;
    if (!doctype || !documentName || !tenantId) {
      return;
    }
    var realtimeOptions = Object.assign({ tenantId: tenantId }, realtimeRoute ? { realtimeRoute: realtimeRoute } : {});
    setPresencePanelState(panel, "loading", "Checking active collaborators.", "Checking active collaborators.");
    setPanelText(panel, "[data-cf-frappe-document-update]", "Viewing latest saved version.");
    setPanelText(panel, "[data-cf-frappe-shared-draft]", "No shared draft proposals.");
    attachPresencePanelMergeSave(panel, doctype, documentName);
    attachPresencePanelSharedDraftApply(panel, doctype, documentName);
    setPresencePanelMergeAction(panel, false, false);
    setPresencePanelSharedDraftAction(panel, false, false);
    realtimePresenceDocument(doctype, documentName, realtimeOptions)
      .then(function (snapshot) {
        setPresencePanelConnections(panel, "ready", snapshot && snapshot.connections);
        subscribePresencePanel(panel, doctype, documentName, realtimeOptions);
      })
      .catch(function (error) {
        setPresencePanelState(
          panel,
          "error",
          "Presence unavailable",
          error && error.message ? error.message : "Unable to load document presence."
        );
      });
  }

  function subscribePresencePanel(panel, doctype, documentName, options) {
    if (panel.__cfFrappePresenceSubscription) {
      return;
    }
    try {
      panel.__cfFrappePresenceSubscription = realtimeSubscribe(
        documentTopicFromOptions(doctype, documentName, options),
        {
          event: function (event) {
            markPresencePanelDocumentEvent(panel, event, doctype, documentName);
          },
          presence: function (presence) {
            setPresencePanelConnections(panel, "live", presence && presence.connections);
          },
          fieldEdit: function (payload) {
            setPresencePanelFieldEdit(panel, payload);
          },
          sharedDraft: function (payload) {
            setPresencePanelSharedDraft(panel, payload, doctype, documentName);
          }
        },
        options
      );
    } catch (_error) {
      panel.__cfFrappePresenceSubscription = undefined;
    }
  }

  function markPresencePanelDocumentEvent(panel, event, doctype, documentName) {
    var payload = event && event.payload;
    var snapshot = payload && payload.snapshot;
    var remoteVersion = snapshot && snapshot.version;
    var localVersion = panel.dataset && panel.dataset.documentVersion ? Number(panel.dataset.documentVersion) : NaN;
    if (typeof remoteVersion !== "number" || Number.isNaN(localVersion) || remoteVersion <= localVersion) {
      return;
    }
    if (panel.dataset) {
      panel.dataset.documentState = "stale";
      panel.dataset.remoteVersion = String(remoteVersion);
    }
    setPanelText(
      panel,
      "[data-cf-frappe-document-update]",
      "Document updated to v" + String(remoteVersion) + ". Refresh to review latest changes."
    );
    var binding = markCurrentFormRemoteUpdate(doctype, documentName, snapshot);
    setPresencePanelMergeAction(panel, Boolean(binding), false, "Merge saved changes");
  }

  function markCurrentFormRemoteUpdate(doctype, documentName, snapshot) {
    var binding = currentFormBinding();
    if (!binding || binding.context.doctype !== doctype || binding.context.documentName !== documentName) {
      return null;
    }
    binding.form.dataset.remoteUpdate = "1";
    if (snapshot && isPlainObject(snapshot.data)) {
      binding.remoteSnapshot = snapshot;
      binding.remoteMergePlan = currentFormMergePlan(binding, snapshot);
      binding.frm.remote_merge_plan = binding.remoteMergePlan;
      binding.form.dataset.remoteMergeState = binding.remoteMergePlan.status;
    }
    return binding;
  }

  function attachPresencePanelMergeSave(panel, doctype, documentName) {
    if (panel.__cfFrappeMergeSaveAttached) {
      return;
    }
    var button = panel.querySelector && panel.querySelector("[data-cf-frappe-merge-save]");
    if (!button || typeof button.addEventListener !== "function") {
      return;
    }
    panel.__cfFrappeMergeSaveAttached = true;
    button.addEventListener("click", function () {
      var binding = currentFormBinding();
      if (!binding || binding.context.doctype !== doctype || binding.context.documentName !== documentName) {
        return;
      }
      setPresencePanelMergeAction(panel, true, true, "Merging...");
      setPanelText(panel, "[data-cf-frappe-document-update]", "Merging saved changes.");
      binding.frm.merge_save()
        .then(function (result) {
          if (result === false) {
            if (panel.dataset) {
              panel.dataset.documentState = "validation-blocked";
            }
            setPanelText(panel, "[data-cf-frappe-document-update]", "Fix validation errors before merging saved changes.");
            setPresencePanelMergeAction(panel, true, false, "Try merge again");
            return;
          }
          updatePresencePanelMergeResult(panel, result);
        })
        .catch(function (error) {
          if (panel.dataset) {
            panel.dataset.documentState = "merge-error";
          }
          setPanelText(
            panel,
            "[data-cf-frappe-document-update]",
            error && error.message ? error.message : "Unable to merge saved changes."
          );
          setPresencePanelMergeAction(panel, true, false, "Try merge again");
        });
    });
  }

  function updatePresencePanelMergeResult(panel, result) {
    var document = result && result.document;
    var version = document && document.version;
    if (result && (result.status === "applied" || result.status === "noop")) {
      if (panel.dataset) {
        panel.dataset.documentState = "merged";
        if (typeof version === "number") {
          panel.dataset.documentVersion = String(version);
          panel.dataset.remoteVersion = String(version);
        }
      }
      setPanelText(
        panel,
        "[data-cf-frappe-document-update]",
        result.status === "applied"
          ? "Merged saved changes" + (typeof version === "number" ? " at v" + String(version) : "") + "."
          : "Already up to date" + (typeof version === "number" ? " at v" + String(version) : "") + "."
      );
      setPresencePanelMergeAction(panel, false, false);
      return;
    }
    if (panel.dataset) {
      panel.dataset.documentState = "conflict";
    }
    setPanelText(panel, "[data-cf-frappe-document-update]", "Merge conflict. Review local changes before saving.");
    setPresencePanelMergeAction(panel, true, false, "Try merge again");
  }

  function setPresencePanelMergeAction(panel, visible, disabled, label) {
    var button = panel.querySelector && panel.querySelector("[data-cf-frappe-merge-save]");
    if (!button) {
      return;
    }
    button.hidden = !visible;
    button.disabled = Boolean(disabled);
    if (label !== undefined) {
      button.textContent = label;
    }
  }

  function attachPresencePanelSharedDraftApply(panel, doctype, documentName) {
    if (panel.__cfFrappeSharedDraftApplyAttached) {
      return;
    }
    var button = panel.querySelector && panel.querySelector("[data-cf-frappe-apply-shared-draft]");
    if (!button || typeof button.addEventListener !== "function") {
      return;
    }
    panel.__cfFrappeSharedDraftApplyAttached = true;
    button.addEventListener("click", function () {
      var binding = currentFormBinding();
      var draft = panel.__cfFrappeSharedDraft;
      if (!binding || binding.context.doctype !== doctype || binding.context.documentName !== documentName || !draft) {
        return;
      }
      if (typeof draft.payload.baseVersion === "number" && binding.baseVersion !== draft.payload.baseVersion) {
        if (panel.dataset) {
          panel.dataset.sharedDraftState = "stale";
        }
        setPresencePanelSharedDraftAction(panel, false, false);
        return;
      }
      setPresencePanelSharedDraftAction(panel, true, true, "Applying...");
      var fields = applySharedDraftToForm(binding, draft.payload);
      if (fields.length === 0) {
        if (panel.dataset) {
          panel.dataset.sharedDraftState = "noop";
        }
        setPanelText(panel, "[data-cf-frappe-shared-draft]", "No applicable shared draft changes.");
        setPresencePanelSharedDraftAction(panel, false, false);
        return;
      }
      if (panel.dataset) {
        panel.dataset.sharedDraftState = "applied";
      }
      setPanelText(
        panel,
        "[data-cf-frappe-shared-draft]",
        "Applied shared draft from " + draft.actor + ": " + presencePanelFieldSummary(fields) + "."
      );
      setPresencePanelSharedDraftAction(panel, false, false);
    });
  }

  function setPresencePanelSharedDraft(panel, payload, doctype, documentName) {
    if (!payload || payload.doctype !== doctype || payload.name !== documentName) {
      return;
    }
    var fields = sharedDraftFields(payload);
    if (fields.length === 0) {
      return;
    }
    var actor = String(payload.actorId || payload.connectionId || "A collaborator");
    panel.__cfFrappeSharedDraft = {
      actor: actor,
      payload: {
        baseVersion: payload.baseVersion,
        patch: isPlainObject(payload.patch) ? cloneMergeValue(payload.patch) : {},
        unset: Array.isArray(payload.unset) ? payload.unset.slice() : []
      }
    };
    if (panel.dataset) {
      panel.dataset.sharedDraftState = "available";
      if (typeof payload.baseVersion === "number") {
        panel.dataset.sharedDraftBaseVersion = String(payload.baseVersion);
      }
    }
    setPanelText(
      panel,
      "[data-cf-frappe-shared-draft]",
      actor + " shared draft changes: " + presencePanelFieldSummary(fields) + "."
    );
    var binding = currentFormBinding();
    var matchingForm = binding && binding.context.doctype === doctype && binding.context.documentName === documentName;
    if (matchingForm && typeof payload.baseVersion === "number" && binding.baseVersion !== payload.baseVersion) {
      if (panel.dataset) {
        panel.dataset.sharedDraftState = "stale";
      }
      setPanelText(
        panel,
        "[data-cf-frappe-shared-draft]",
        actor + " shared draft changes for v" + String(payload.baseVersion) +
          "; current form is v" + String(binding.baseVersion) + "."
      );
      setPresencePanelSharedDraftAction(panel, false, false);
      return;
    }
    setPresencePanelSharedDraftAction(
      panel,
      Boolean(matchingForm),
      false,
      "Apply shared draft"
    );
  }

  function applySharedDraftToForm(binding, payload) {
    syncFormData(binding);
    var draft = cloneMergeValue(binding.doc);
    var changed = [];
    var patch = isPlainObject(payload && payload.patch) ? payload.patch : {};
    Object.keys(patch).forEach(function (field) {
      var fieldname = String(field || "").trim();
      if (!fieldname || isInternalFormField(fieldname)) {
        return;
      }
      setDocValue(draft, fieldname, cloneMergeValue(patch[field]));
      changed.push(fieldname);
    });
    (Array.isArray(payload && payload.unset) ? payload.unset : []).forEach(function (field) {
      var fieldname = String(field || "").trim();
      if (!fieldname || isInternalFormField(fieldname) || changed.indexOf(fieldname) >= 0) {
        return;
      }
      unsetDocValue(draft, fieldname);
      changed.push(fieldname);
    });
    if (changed.length === 0) {
      return changed;
    }
    binding.doc = draft;
    binding.frm.doc = draft;
    writeDocumentToForm(binding, draft);
    binding.frm.dirty();
    changed.forEach(function (field) {
      triggerFormEvent(binding, field);
    });
    return changed;
  }

  function unsetDocValue(doc, fieldname) {
    var child = childFieldPath(fieldname);
    if (child) {
      var rows = Array.isArray(doc[child.table]) ? doc[child.table] : [];
      if (rows[child.index]) {
        delete rows[child.index][child.field];
      }
      doc[child.table] = rows;
      return;
    }
    delete doc[fieldname];
  }

  function sharedDraftFields(payload) {
    var seen = {};
    var fields = [];
    var patch = isPlainObject(payload && payload.patch) ? payload.patch : {};
    Object.keys(patch).forEach(function (field) {
      addSharedDraftField(fields, seen, field);
    });
    (Array.isArray(payload && payload.unset) ? payload.unset : []).forEach(function (field) {
      addSharedDraftField(fields, seen, field);
    });
    return fields;
  }

  function addSharedDraftField(fields, seen, field) {
    var fieldname = String(field || "").trim();
    if (!fieldname || seen[fieldname]) {
      return;
    }
    seen[fieldname] = true;
    fields.push(fieldname);
  }

  function presencePanelFieldSummary(fields) {
    var visible = fields.slice(0, 5);
    var suffix = fields.length > visible.length ? " +" + String(fields.length - visible.length) + " more" : "";
    return visible.join(", ") + suffix;
  }

  function setPresencePanelSharedDraftAction(panel, visible, disabled, label) {
    var button = panel.querySelector && panel.querySelector("[data-cf-frappe-apply-shared-draft]");
    if (!button) {
      return;
    }
    button.hidden = !visible;
    button.disabled = Boolean(disabled);
    if (label !== undefined) {
      button.textContent = label;
    }
  }

  function setPresencePanelConnections(panel, state, connections) {
    prunePresencePanelFieldEdits(panel, connections);
    var labels = presenceConnectionLabels(connections);
    var count = labels.length;
    setPresencePanelState(
      panel,
      state,
      count === 1 ? "1 active collaborator" : String(count) + " active collaborators",
      count === 0 ? "No active collaborators are viewing this document." : labels.join(", ")
    );
  }

  function presenceConnectionLabels(connections) {
    var seen = {};
    var labels = [];
    (Array.isArray(connections) ? connections : []).forEach(function (connection) {
      var label = connection && (connection.userId || connection.connectionId);
      if (!label || seen[label]) {
        return;
      }
      seen[label] = true;
      labels.push(String(label));
    });
    return labels;
  }

  function setPresencePanelFieldEdit(panel, payload) {
    if (!payload || !payload.field) {
      return;
    }
    var edits = panel.__cfFrappeFieldEdits || {};
    var key = String(payload.connectionId || "") + ":" + String(payload.field);
    if (payload.editing === false) {
      delete edits[key];
    } else {
      edits[key] = {
        actor: payload.actorId || payload.connectionId || "A collaborator",
        connectionId: payload.connectionId,
        field: payload.field
      };
    }
    panel.__cfFrappeFieldEdits = edits;
    renderPresencePanelFieldEdits(panel);
  }

  function prunePresencePanelFieldEdits(panel, connections) {
    var edits = panel.__cfFrappeFieldEdits;
    if (!edits || !Array.isArray(connections)) {
      return;
    }
    var active = {};
    connections.forEach(function (connection) {
      if (connection && connection.connectionId) {
        active[String(connection.connectionId)] = true;
      }
    });
    var changed = false;
    Object.keys(edits).forEach(function (editKey) {
      var edit = edits[editKey];
      var connectionId = edit && edit.connectionId;
      if (!connectionId || !active[String(connectionId)]) {
        delete edits[editKey];
        changed = true;
      }
    });
    if (changed) {
      renderPresencePanelFieldEdits(panel);
    }
  }

  function renderPresencePanelFieldEdits(panel) {
    var edits = panel.__cfFrappeFieldEdits || {};
    var labels = Object.keys(edits).sort().map(function (editKey) {
      var edit = edits[editKey];
      return String(edit.actor) + " editing " + String(edit.field);
    });
    setPanelText(
      panel,
      "[data-cf-frappe-field-edits]",
      labels.length === 0 ? "No live field edits." : labels.join(", ")
    );
  }

  function setPresencePanelState(panel, state, countText, listText) {
    if (panel.dataset) {
      panel.dataset.presenceState = state;
    }
    setPanelText(panel, "[data-cf-frappe-presence-count]", countText);
    setPanelText(panel, "[data-cf-frappe-presence-list]", listText);
  }

  function setPanelText(panel, selector, value) {
    var target = typeof panel.querySelector === "function" ? panel.querySelector(selector) : null;
    if (target) {
      target.textContent = value;
    }
  }

  function msgprint(message) {
    var text = message == null ? "" : String(message);
    if (typeof root.alert === "function") {
      root.alert(text);
    }
    return text;
  }

  function throwMessage(message) {
    var text = msgprint(message);
    throw new Error(text);
  }

  root.cfFrappe = Object.freeze(Object.assign({}, root.cfFrappe || {}, {
    context: context,
    audit: Object.freeze({
      deleted: function (doctype, name, options) {
        return request(auditDeletedPath(doctype, name, options || {})).then(unwrapData);
      },
      events: function (options) {
        return request(withQuery("/api/audit/events", auditEventParams(options || {}))).then(unwrapData);
      }
    }),
    auth: Object.freeze({
      completeEmailVerification: function (input) {
        return request("/api/auth/email-verification/complete", { method: "POST", body: input || {} }).then(unwrapData);
      },
      completePasswordReset: function (input) {
        return request("/api/auth/password-reset/complete", { method: "POST", body: input || {} }).then(unwrapData);
      },
      login: function (input) {
        return request("/api/auth/login", { method: "POST", body: input || {} }).then(unwrapData);
      },
      logout: function () {
        return request("/api/auth/logout", { method: "POST" }).then(unwrapData);
      },
      me: function () {
        return request("/api/auth/me").then(unwrapData);
      },
      requestEmailVerification: function (input) {
        return request("/api/auth/email-verification/request", { method: "POST", body: input || {} }).then(unwrapData);
      },
      requestPasswordReset: function (input) {
        return request("/api/auth/password-reset/request", { method: "POST", body: input || {} }).then(unwrapData);
      }
    }),
    accounts: Object.freeze({
      changePassword: function (userId, input, options) {
        return request(accountPath(userId, "password", options || {}), {
          method: "PUT",
          body: passwordBody(input, options)
        }).then(unwrapData);
      },
      changeRoles: function (userId, input, options) {
        return request(accountPath(userId, "roles", options || {}), {
          method: "PUT",
          body: rolesBody(input, options)
        }).then(unwrapData);
      },
      create: function (userId, input, options) {
        return request(accountPath(userId, undefined, options || {}), {
          method: "POST",
          body: commandBody(input || {}, options)
        }).then(unwrapData);
      },
      disable: function (userId, options) {
        return request(accountPath(userId, "disable", options || {}), {
          method: "POST",
          body: versionBody(options)
        }).then(unwrapData);
      },
      enable: function (userId, options) {
        return request(accountPath(userId, "enable", options || {}), {
          method: "POST",
          body: versionBody(options)
        }).then(unwrapData);
      },
      get: function (userId, options) {
        return request(accountPath(userId, undefined, options || {})).then(unwrapData);
      },
      syncProvider: function (userId, input, options) {
        return request(accountPath(userId, "provider-sync", options || {}), {
          method: "POST",
          body: commandBody(input, options)
        }).then(unwrapData);
      }
    }),
    linkOptions: function (doctype, field, params) {
      return request(linkOptionsPath(doctype, field, params)).then(unwrapData);
    },
    search: function (q, options) {
      return request(withQuery("/api/search", searchParams(q, options || {}))).then(unwrapData);
    },
    customFields: Object.freeze({
      disable: function (doctype, field, options) {
        return request(customFieldPath(doctype, field, options || {}), { method: "DELETE", body: versionBody(options) }).then(unwrapData);
      },
      list: function (doctype, options) {
        return request(customFieldPath(doctype, undefined, options || {})).then(unwrapData);
      },
      save: function (doctype, field, options) {
        return request(customFieldPath(doctype, undefined, options || {}), { method: "POST", body: customFieldBody(field, options) }).then(unwrapData);
      }
    }),
    fieldProperties: Object.freeze({
      clear: function (doctype, field, options) {
        return request(fieldPropertyPath(doctype, field, options || {}), { method: "DELETE", body: versionBody(options) }).then(unwrapData);
      },
      list: function (doctype, options) {
        return request(fieldPropertyPath(doctype, undefined, options || {})).then(unwrapData);
      },
      save: function (doctype, field, overrides, options) {
        return request(fieldPropertyPath(doctype, field, options || {}), { method: "PUT", body: fieldPropertyBody(overrides, options) }).then(unwrapData);
      }
    }),
    workflows: Object.freeze({
      clear: function (doctype, options) {
        return request(workflowPath(doctype, options || {}), { method: "DELETE", body: versionBody(options) }).then(unwrapData);
      },
      get: function (doctype, options) {
        return request(workflowPath(doctype, options || {})).then(unwrapData);
      },
      save: function (doctype, workflow, options) {
        return request(workflowPath(doctype, options || {}), { method: "PUT", body: workflowBody(workflow, options) }).then(unwrapData);
      }
    }),
    userPermissions: Object.freeze({
      allow: function (userId, grant, options) {
        return request(userPermissionPath(userId, options || {}), { method: "POST", body: userPermissionBody(grant, options) }).then(unwrapData);
      },
      get: function (userId, options) {
        return request(userPermissionPath(userId, options || {})).then(unwrapData);
      },
      revoke: function (userId, grant, options) {
        return request(userPermissionPath(userId, options || {}), { method: "DELETE", body: userPermissionBody(grant, options) }).then(unwrapData);
      }
    }),
    dataPatches: Object.freeze({
      apply: function (options) {
        return request(dataPatchPath(undefined, "apply"), { method: "POST", body: dataPatchBody(options) }).then(unwrapData);
      },
      applyOne: function (patchId) {
        return request(dataPatchPath(patchId, "apply"), { method: "POST" }).then(unwrapData);
      },
      enqueue: function (options) {
        return request(dataPatchPath(undefined, "enqueue"), { method: "POST", body: dataPatchBody(options) }).then(unwrapData);
      },
      enqueueOne: function (patchId, options) {
        return request(dataPatchPath(patchId, "enqueue"), { method: "POST", body: dataPatchBody(options, false) }).then(unwrapData);
      },
      plan: function (options) {
        return request(dataPatchPath(undefined, "plan"), { method: "POST", body: dataPatchBody(options) }).then(unwrapData);
      },
      planOne: function (patchId) {
        return request(dataPatchPath(patchId, "plan"), { method: "POST" }).then(unwrapData);
      },
      rollbackPlan: function (options) {
        return request(dataPatchPath(undefined, "rollback-plan"), { method: "POST", body: dataPatchBody(options) }).then(unwrapData);
      },
      rollbackPlanOne: function (patchId) {
        return request(dataPatchPath(patchId, "rollback-plan"), { method: "POST" }).then(unwrapData);
      },
      rollback: function (options) {
        return request(dataPatchPath(undefined, "rollback"), { method: "POST", body: dataPatchBody(options) }).then(unwrapData);
      },
      rollbackOne: function (patchId) {
        return request(dataPatchPath(patchId, "rollback"), { method: "POST" }).then(unwrapData);
      },
      rollbackEnqueue: function (options) {
        return request(dataPatchPath(undefined, "rollback-enqueue"), { method: "POST", body: dataPatchBody(options) }).then(unwrapData);
      },
      rollbackEnqueueOne: function (patchId, options) {
        return request(dataPatchPath(patchId, "rollback-enqueue"), { method: "POST", body: dataPatchBody(options, false) }).then(unwrapData);
      },
      rollbackRetry: function (patchId) {
        return request(dataPatchPath(patchId, "rollback-retry"), { method: "POST" }).then(unwrapData);
      },
      rollbackRetryEnqueue: function (patchId, options) {
        return request(dataPatchPath(patchId, "rollback-retry-enqueue"), {
          method: "POST",
          body: dataPatchBody(options, false)
        }).then(unwrapData);
      },
      retry: function (patchId) {
        return request(dataPatchPath(patchId, "retry"), { method: "POST" }).then(unwrapData);
      },
      status: function () {
        return request(dataPatchPath()).then(unwrapData);
      }
    }),
    dashboard: Object.freeze({
      get: function (dashboard) {
        return request(dashboardMetaPath(dashboard)).then(unwrapData);
      },
      list: function () {
        return request(dashboardMetaPath()).then(unwrapData);
      },
      run: function (dashboard) {
        return request(dashboardPath(dashboard, "run")).then(unwrapData);
      }
    }),
    kanban: Object.freeze({
      get: function (kanban) {
        return request(kanbanMetaPath(kanban)).then(unwrapData);
      },
      list: function () {
        return request(kanbanMetaPath()).then(unwrapData);
      },
      run: function (kanban) {
        return request(kanbanPath(kanban, "run")).then(unwrapData);
      }
    }),
    calendar: Object.freeze({
      get: function (calendar) {
        return request(calendarMetaPath(calendar)).then(unwrapData);
      },
      list: function () {
        return request(calendarMetaPath()).then(unwrapData);
      },
      run: function (calendar, options) {
        return request(calendarPath(calendar, "run", options || {})).then(unwrapData);
      }
    }),
    jobs: Object.freeze({
      createSchedule: function (input) {
        return request(jobSchedulePath(), { method: "POST", body: input || {} }).then(unwrapData);
      },
      dashboard: function (options) {
        return request(withQuery("/api/jobs", jobDashboardParams(options || {}))).then(unwrapData);
      },
      deleteSchedule: function (scheduleId) {
        return request(jobSchedulePath(scheduleId), { method: "DELETE" }).then(unwrapData);
      },
      disableSchedule: function (scheduleId) {
        return request(jobSchedulePath(scheduleId, "disable"), { method: "POST" }).then(unwrapData);
      },
      enableSchedule: function (scheduleId) {
        return request(jobSchedulePath(scheduleId, "enable"), { method: "POST" }).then(unwrapData);
      },
      execution: function (idempotencyKey) {
        return request(jobExecutionPath(idempotencyKey)).then(unwrapData);
      },
      pauseSchedule: function (scheduleId, pausedUntil) {
        return request(jobSchedulePath(scheduleId, "pause"), {
          method: "POST",
          body: { pauseUntil: pausedUntil }
        }).then(unwrapData);
      },
      resetSchedule: function (scheduleId) {
        return request(jobSchedulePath(scheduleId, "reset"), { method: "POST" }).then(unwrapData);
      },
      retry: function (idempotencyKey) {
        return request(jobExecutionPath(idempotencyKey, "retry"), { method: "POST" }).then(unwrapData);
      },
      runSchedule: function (scheduleId) {
        return request(jobSchedulePath(scheduleId, "run"), { method: "POST" }).then(unwrapData);
      },
      schedules: function (options) {
        return request(withQuery(jobSchedulePath(), jobScheduleParams(options || {}))).then(unwrapData);
      },
      updateSchedule: function (scheduleId, input) {
        return request(jobSchedulePath(scheduleId), { method: "PUT", body: input || {} }).then(unwrapData);
      }
    }),
    form: Object.freeze({
      current: function () {
        var binding = currentFormBinding();
        return binding ? binding.frm : null;
      },
      on: registerFormHandlers,
      trigger: function (eventName) {
        var binding = currentFormBinding();
        return binding ? triggerFormEvent(binding, eventName) : undefined;
      }
    }),
    history: Object.freeze({
      assignments: function (doctype, name) {
        return request(resourceActionPath(doctype, name, "assignments")).then(unwrapData);
      },
      followers: function (doctype, name) {
        return request(resourceActionPath(doctype, name, "followers")).then(unwrapData);
      },
      shares: function (doctype, name) {
        return request(resourceActionPath(doctype, name, "shares")).then(unwrapData);
      },
      tags: function (doctype, name) {
        return request(resourceActionPath(doctype, name, "tags")).then(unwrapData);
      },
      timeline: function (doctype, name, options) {
        return request(withQuery(resourceActionPath(doctype, name, "timeline"), timelineParams(options || {}))).then(unwrapData);
      }
    }),
    files: Object.freeze({
      bulkDelete: function (files) {
        return request("/api/files/delete", { method: "POST", body: bulkFilesBody(files) }).then(unwrapData);
      },
      bulkUpdateMetadata: function (files, input) {
        return request("/api/files/bulk-metadata", { method: "POST", body: bulkFilesBody(files, input) }).then(unwrapData);
      },
      abortMultipartUpload: abortMultipartUpload,
      completeDirectUpload: completeDirectUpload,
      completeMultipartUpload: completeMultipartUpload,
      contentUrl: function (name) {
        return filePath(name, "content");
      },
      delete: function (name, options) {
        return request(withQuery(filePath(name), versionBody(options)), { method: "DELETE" }).then(unwrapData);
      },
      generateRendition: function (name, options) {
        return request(filePath(name, "renditions"), { method: "POST", body: options || {} });
      },
      list: function (options) {
        return request(withQuery("/api/files", fileListParams(options || {}))).then(unwrapData);
      },
      prepareDirectUpload: prepareDirectUpload,
      prepareMultipartUpload: prepareMultipartUpload,
      previewUrl: function (name) {
        return filePath(name, "preview");
      },
      renditionContentUrl: function (name, renditionId) {
        return filePath(name, "renditions/" + encodePart(renditionId) + "/content");
      },
      transformUrl: function (name, options) {
        return withQuery(filePath(name, "transform"), fileTransformParams(options || {}));
      },
      updateMetadata: function (name, input, options) {
        return request(filePath(name), { method: "PATCH", body: commandBody(input, options) }).then(unwrapData);
      },
      upload: async function (body, options) {
        preflightKnownUploadSize(uploadBodySize(body), options || {});
        return request(withQuery("/api/files", fileUploadParams(options || {})), {
          method: "POST",
          body: body,
          headers: fileUploadHeaders(options || {})
        });
      },
      uploadDirect: uploadDirectFile,
      uploadMultipart: uploadMultipartFile,
      uploadMultipartPart: uploadMultipartPart
    }),
    meta: Object.freeze({
      customFields: function (doctype, options) {
        return request(customFieldPath(doctype, undefined, options || {})).then(unwrapData);
      },
      dashboard: function (dashboard) {
        return request(dashboardMetaPath(dashboard)).then(unwrapData);
      },
      dashboards: function () {
        return request(dashboardMetaPath()).then(unwrapData);
      },
      kanban: function (kanban) {
        return request(kanbanMetaPath(kanban)).then(unwrapData);
      },
      kanbans: function () {
        return request(kanbanMetaPath()).then(unwrapData);
      },
      calendar: function (calendar) {
        return request(calendarMetaPath(calendar)).then(unwrapData);
      },
      calendars: function () {
        return request(calendarMetaPath()).then(unwrapData);
      },
      doctype: function (doctype) {
        return request("/api/meta/doctypes/" + encodePart(doctype)).then(unwrapData);
      },
      doctypes: function () {
        return request("/api/meta/doctypes").then(unwrapData);
      },
      fieldProperties: function (doctype, options) {
        return request(fieldPropertyPath(doctype, undefined, options || {})).then(unwrapData);
      },
      listView: function (doctype) {
        return request("/api/meta/doctypes/" + encodePart(doctype) + "/list-view").then(unwrapData);
      },
      linkOptions: function (doctype, field, params) {
        return request(linkOptionsPath(doctype, field, params)).then(unwrapData);
      },
      notificationRules: function (doctype, options) {
        return request(notificationRulePath(doctype, undefined, options || {})).then(unwrapData);
      },
      profile: function (userId, options) {
        return request(profilePath(userId, options || {})).then(unwrapData);
      },
      printFormat: function (format) {
        return request(printFormatPath(format)).then(unwrapData);
      },
      printFormats: function (options) {
        return request(withQuery(printFormatPath(), printFormatParams(options || {}))).then(unwrapData);
      },
      printLetterhead: function (letterhead) {
        return request(printLetterheadPath(letterhead)).then(unwrapData);
      },
      printLetterheads: function () {
        return request(printLetterheadPath()).then(unwrapData);
      },
      report: function (report) {
        return request("/api/meta/reports/" + encodePart(report)).then(unwrapData);
      },
      reports: function () {
        return request("/api/meta/reports").then(unwrapData);
      },
      role: function (role, options) {
        return request(rolePath(role, options || {})).then(unwrapData);
      },
      roles: function (options) {
        return request(rolesPath(options || {})).then(unwrapData);
      },
      userPermissions: function (userId, options) {
        return request(userPermissionPath(userId, options || {})).then(unwrapData);
      },
      workflow: function (doctype, options) {
        return request(workflowPath(doctype, options || {})).then(unwrapData);
      },
      workspace: function (workspace) {
        return request("/api/meta/workspaces/" + encodePart(workspace)).then(unwrapData);
      },
      workspaces: function () {
        return request("/api/meta/workspaces").then(unwrapData);
      }
    }),
    notifications: Object.freeze({
      dismiss: function (notificationId, options) {
        return request(notificationActionPath(notificationId, "dismiss", options || {}), { method: "POST" }).then(unwrapData);
      },
      inbox: function (options) {
        return request(withQuery("/api/notifications", notificationInboxParams(options || {}))).then(unwrapData);
      },
      markRead: function (notificationId, options) {
        return request(notificationActionPath(notificationId, "read", options || {}), { method: "POST" }).then(unwrapData);
      }
    }),
    notificationRules: Object.freeze({
      clear: function (doctype, rule, options) {
        return request(notificationRulePath(doctype, rule, options || {}), { method: "DELETE", body: versionBody(options) }).then(unwrapData);
      },
      disable: function (doctype, rule, options) {
        return toggleNotificationRule(doctype, rule, false, options);
      },
      enable: function (doctype, rule, options) {
        return toggleNotificationRule(doctype, rule, true, options);
      },
      get: function (doctype, rule, options) {
        return getNotificationRule(doctype, rule, options);
      },
      list: function (doctype, options) {
        return request(notificationRulePath(doctype, undefined, options || {})).then(unwrapData);
      },
      save: function (doctype, rule, options) {
        return request(notificationRulePath(doctype, rule.name, options || {}), { method: "PUT", body: notificationRuleBody(rule, options) }).then(unwrapData);
      }
    }),
    profiles: Object.freeze({
      get: function (userId, options) {
        return request(profilePath(userId, options || {})).then(unwrapData);
      },
      update: function (userId, input, options) {
        return request(profilePath(userId, options || {}), { method: "PUT", body: commandBody(input, options) }).then(unwrapData);
      }
    }),
    print: Object.freeze({
      format: function (format) {
        return request(printFormatPath(format)).then(unwrapData);
      },
      formats: function (options) {
        return request(withQuery(printFormatPath(), printFormatParams(options || {}))).then(unwrapData);
      },
      letterhead: function (letterhead) {
        return request(printLetterheadPath(letterhead)).then(unwrapData);
      },
      letterheads: function () {
        return request(printLetterheadPath()).then(unwrapData);
      },
      html: function (format, name) {
        return request(printDocumentPath(format, name));
      },
      pdf: function (format, name) {
        return requestBinary(printPdfDocumentPath(format, name));
      },
      pdfUrl: printPdfDocumentPath,
      settings: function (options) {
        return request(printSettingsPath(options || {})).then(unwrapData);
      },
      updateSettings: function (input, options) {
        return request(printSettingsPath(options || {}), {
          method: "PUT",
          body: Object.assign({}, input || {}, versionBody(options || {}))
        }).then(unwrapData);
      },
      url: printDocumentPath
    }),
    realtime: Object.freeze({
      connect: function (topic, options) {
        return new WebSocket(realtimeUrl(topic, options), options && options.protocols);
      },
      doctype: function (doctype, options) {
        return new WebSocket(realtimeUrl(doctypeTopicFromOptions(doctype, options), options), options && options.protocols);
      },
      doctypeUrl: function (doctype, options) {
        return realtimeUrl(doctypeTopicFromOptions(doctype, options), options).toString();
      },
      document: function (doctype, name, options) {
        return new WebSocket(realtimeUrl(documentTopicFromOptions(doctype, name, options), options), options && options.protocols);
      },
      documentUrl: function (doctype, name, options) {
        return realtimeUrl(documentTopicFromOptions(doctype, name, options), options).toString();
      },
      tenant: function (options) {
        return new WebSocket(realtimeUrl(tenantTopicFromOptions(options), options), options && options.protocols);
      },
      tenantUrl: function (options) {
        return realtimeUrl(tenantTopicFromOptions(options), options).toString();
      },
      user: function (userId, options) {
        return new WebSocket(realtimeUrl(userTopicFromOptions(userId, options), options), options && options.protocols);
      },
      userUrl: function (userId, options) {
        return realtimeUrl(userTopicFromOptions(userId, options), options).toString();
      },
      presence: realtimePresence,
      presenceDoctype: function (doctype, options) {
        return realtimePresence(doctypeTopicFromOptions(doctype, options), options);
      },
      presenceDocument: function (doctype, name, options) {
        return realtimePresenceDocument(doctype, name, options);
      },
      presenceTenant: function (options) {
        return realtimePresence(tenantTopicFromOptions(options), options);
      },
      presenceUrl: realtimePresenceUrl,
      presenceUser: function (userId, options) {
        return realtimePresence(userTopicFromOptions(userId, options), options);
      },
      subscribe: function (topic, handlers, options) {
        return realtimeSubscribe(topic, handlers, options);
      },
      subscribeDoctype: function (doctype, handlers, options) {
        return realtimeSubscribe(doctypeTopicFromOptions(doctype, options), handlers, options);
      },
      subscribeDocument: function (doctype, name, handlers, options) {
        return realtimeSubscribe(documentTopicFromOptions(doctype, name, options), handlers, options);
      },
      subscribeTenant: function (handlers, options) {
        return realtimeSubscribe(tenantTopicFromOptions(options), handlers, options);
      },
      subscribeUser: function (userId, handlers, options) {
        return realtimeSubscribe(userTopicFromOptions(userId, options), handlers, options);
      },
      url: function (topic, options) {
        return realtimeUrl(topic, options).toString();
      }
    }),
    collaboration: Object.freeze({
      fieldEditMessage: realtimeFieldEditMessage,
      mergePlan: documentMergePlan,
      sendFieldEdit: function (subscription, field, input) {
        if (!subscription || typeof subscription.sendFieldEdit !== "function") {
          return realtimeFieldEditMessage(field, input);
        }
        return subscription.sendFieldEdit(field, input);
      },
      sendSharedDraft: function (subscription, input) {
        if (!subscription || typeof subscription.sendSharedDraft !== "function") {
          return realtimeSharedDraftMessage(input);
        }
        return subscription.sendSharedDraft(input);
      },
      sharedDraftMessage: realtimeSharedDraftMessage
    }),
    report: Object.freeze({
      csvUrl: function (report, options) {
        return withQuery(reportPath(report, "export.csv"), reportExportParams(options || {}));
      },
      get: function (report) {
        return request("/api/meta/reports/" + encodePart(report)).then(unwrapData);
      },
      list: function () {
        return request("/api/meta/reports").then(unwrapData);
      },
      pdf: function (report, options) {
        return requestBinary(reportPdfPath(report, options || {}));
      },
      pdfUrl: reportPdfPath,
      run: function (report, options) {
        return request(withQuery(reportPath(report, "run"), reportRunParams(options || {})));
      }
    }),
    reportBuilder: Object.freeze({
      create: function (doctype, input) {
        return request(reportBuilderPath(doctype), { method: "POST", body: input || {} }).then(unwrapData);
      },
      csvUrl: function (doctype, id, options) {
        return withQuery(reportBuilderPath(doctype, id, "export.csv"), reportExportParams(options || {}));
      },
      delete: function (doctype, id) {
        return request(reportBuilderPath(doctype, id), { method: "DELETE" }).then(unwrapData);
      },
      get: function (doctype, id) {
        return request(reportBuilderPath(doctype, id)).then(unwrapData);
      },
      list: function (doctype) {
        return request(reportBuilderPath(doctype)).then(unwrapData);
      },
      pdf: function (doctype, id, options) {
        return requestBinary(reportBuilderPdfPath(doctype, id, options || {}));
      },
      pdfUrl: reportBuilderPdfPath,
      run: function (doctype, id, options) {
        return request(withQuery(reportBuilderPath(doctype, id, "run"), reportRunParams(options || {})));
      },
      update: function (doctype, id, input) {
        return request(reportBuilderPath(doctype, id), { method: "PUT", body: input || {} }).then(unwrapData);
      }
    }),
    roles: Object.freeze({
      changeDescription: function (role, input, options) {
        return request(roleActionPath(role, "description", options || {}), { method: "PUT", body: descriptionBody(input, options) }).then(unwrapData);
      },
      create: function (role, input, options) {
        return request(rolePath(role, options || {}), { method: "POST", body: commandBody(input || {}, options) }).then(unwrapData);
      },
      disable: function (role, options) {
        return request(roleActionPath(role, "disable", options || {}), { method: "POST", body: versionBody(options) }).then(unwrapData);
      },
      enable: function (role, options) {
        return request(roleActionPath(role, "enable", options || {}), { method: "POST", body: versionBody(options) }).then(unwrapData);
      },
      get: function (role, options) {
        return request(rolePath(role, options || {})).then(unwrapData);
      },
      list: function (options) {
        return request(rolesPath(options || {})).then(unwrapData);
      }
    }),
    request: request,
    msgprint: msgprint,
    throw: throwMessage,
    ui: Object.freeze({
      msgprint: msgprint
    }),
    desk: Object.freeze({
      adminCustomFieldsUrl: deskAdminCustomFieldsPath,
      adminDataPatchesUrl: function () {
        return "/desk/admin/data-patches";
      },
      adminFieldPropertiesUrl: deskAdminFieldPropertiesPath,
      adminJobsUrl: function (options) {
        return withQuery("/desk/admin/jobs", jobDashboardParams(options || {}));
      },
      adminJobSchedulesUrl: function (options) {
        return withQuery("/desk/admin/jobs/schedules", jobScheduleParams(options || {}));
      },
      adminPrintSettingsUrl: function () {
        return "/desk/admin/print-settings";
      },
      adminRolesUrl: function () {
        return "/desk/admin/roles";
      },
      adminUserPermissionsUrl: deskAdminUserPermissionsPath,
      adminUsersUrl: deskAdminUsersPath,
      adminWorkflowsUrl: deskAdminWorkflowsPath,
      dashboardUrl: deskDashboardPath,
      kanbanUrl: deskKanbanPath,
      calendarUrl: deskCalendarPath,
      fileContentUrl: function (name) {
        return deskFilePath(name, "content");
      },
      filesUrl: deskFilesPath,
      filePreviewUrl: function (name) {
        return deskFilePath(name, "preview");
      },
      listUrl: function (doctype, options) {
        return withQuery(deskPath(doctype), resourceListParams(options || {}));
      },
      csvUrl: function (doctype, options) {
        return withQuery(deskPath(doctype) + "/export.csv", resourceExportParams(options || {}));
      },
      formUrl: function (doctype, name) {
        return deskPath(doctype) + "/" + encodePart(name);
      },
      importTemplateCsvUrl: function (doctype) {
        return deskPath(doctype) + "/import-template.csv";
      },
      notificationsUrl: deskNotificationsPath,
      printPdfUrl: deskPrintPdfPath,
      printUrl: deskPrintPath,
      reportBuilderUrl: deskReportBuilderPath,
      reportBuilderPdfUrl: deskReportBuilderPdfPath,
      reportPdfUrl: deskReportPdfPath,
      reportUrl: deskReportPath,
      searchUrl: deskSearchPath,
      workspaceUrl: deskWorkspacePath,
      importCsv: function (doctype, csv, options) {
        return request(deskPath(doctype) + "/import.csv", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
          body: deskImportBody(doctype, csv, options || {})
        });
      },
      bulkDelete: function (doctype, documents, options) {
        return request(deskPath(doctype) + "/bulk-delete", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
          body: deskBulkDocumentsBody(doctype, documents, options || {})
        });
      },
      bulkSubmit: function (doctype, documents, options) {
        return request(deskPath(doctype) + "/bulk-submit", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
          body: deskBulkDocumentsBody(doctype, documents, options || {})
        });
      },
      bulkCancel: function (doctype, documents, options) {
        return request(deskPath(doctype) + "/bulk-cancel", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
          body: deskBulkDocumentsBody(doctype, documents, options || {})
        });
      },
      bulkTransition: function (doctype, action, documents, options) {
        return request(deskPath(doctype) + "/bulk-transition/" + encodePart(action), {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
          body: deskBulkDocumentsBody(doctype, documents, options || {})
        });
      },
      newUrl: function (doctype) {
        return deskPath(doctype) + "/new";
      }
    }),
    resource: Object.freeze({
      activity: function (doctype, name, input, options) {
        return request(resourceActionPath(doctype, name, "activities"), { method: "POST", body: commandBody(input, options) }).then(unwrapData);
      },
      assign: function (doctype, name, assignee, options) {
        return request(resourceActionPath(doctype, name, "assignments"), { method: "POST", body: Object.assign({ assignee: assignee }, versionBody(options)) }).then(unwrapData);
      },
      assignments: function (doctype, name) {
        return request(resourceActionPath(doctype, name, "assignments")).then(unwrapData);
      },
      bulkCancel: function (doctype, documents) {
        return request(resourcePath(doctype) + "/bulk-cancel", { method: "POST", body: bulkDocumentsBody(documents) }).then(unwrapData);
      },
      bulkDelete: function (doctype, documents) {
        return request(resourcePath(doctype) + "/delete", { method: "POST", body: bulkDocumentsBody(documents) }).then(unwrapData);
      },
      bulkSubmit: function (doctype, documents) {
        return request(resourcePath(doctype) + "/bulk-submit", { method: "POST", body: bulkDocumentsBody(documents) }).then(unwrapData);
      },
      bulkTransition: function (doctype, action, documents) {
        return request(resourcePath(doctype) + "/bulk-transition/" + encodePart(action), { method: "POST", body: bulkDocumentsBody(documents) }).then(unwrapData);
      },
      amend: function (doctype, name, input, options) {
        return request(resourcePath(doctype, name) + "/amend", { method: "POST", body: commandBody(input || {}, options) }).then(unwrapData);
      },
      cancel: function (doctype, name, options) {
        return request(resourcePath(doctype, name) + "/cancel", { method: "POST", body: versionBody(options) }).then(unwrapData);
      },
      command: function (doctype, name, command, input, options) {
        return request(resourcePath(doctype, name) + "/command/" + encodePart(command), { method: "POST", body: commandBody(input, options) }).then(unwrapData);
      },
      comment: function (doctype, name, input, options) {
        return request(resourceActionPath(doctype, name, "comments"), { method: "POST", body: commentBody(input, options) }).then(unwrapData);
      },
      create: function (doctype, data) {
        return request(resourcePath(doctype), { method: "POST", body: data || {} }).then(unwrapData);
      },
      csvUrl: function (doctype, options) {
        return withQuery(resourcePath(doctype) + "/export.csv", resourceExportParams(options || {}));
      },
      importTemplateCsvUrl: function (doctype) {
        return resourcePath(doctype) + "/import-template.csv";
      },
      importCsv: function (doctype, csv, options) {
        var params = {};
        setParam(params, "mode", options && options.mode);
        setParam(params, "max_rows", options && (options.maxRows !== undefined ? options.maxRows : options.max_rows));
        return request(withQuery(resourcePath(doctype) + "/import.csv", params), {
          method: "POST",
          headers: { "content-type": "text/csv; charset=utf-8" },
          body: csv || ""
        }).then(unwrapData);
      },
      delete: function (doctype, name, options) {
        return request(resourcePath(doctype, name), { method: "DELETE", body: versionBody(options) }).then(unwrapData);
      },
      deleteSavedFilter: function (doctype, filterId) {
        return request(resourcePath(doctype) + "/saved-filters/" + encodePart(filterId), { method: "DELETE" }).then(unwrapData);
      },
      duplicate: function (doctype, name, input, options) {
        return request(resourcePath(doctype, name) + "/duplicate", { method: "POST", body: commandBody(input || {}, options) }).then(unwrapData);
      },
      follow: function (doctype, name, options) {
        return request(resourceActionPath(doctype, name, "followers"), { method: "POST", body: commandBody(options || {}, options) }).then(unwrapData);
      },
      followers: function (doctype, name) {
        return request(resourceActionPath(doctype, name, "followers")).then(unwrapData);
      },
      get: function (doctype, name) {
        return request(resourcePath(doctype, name)).then(unwrapData);
      },
      list: function (doctype, options) {
        return request(withQuery(resourcePath(doctype), resourceListParams(options || {})));
      },
      listSavedFilters: function (doctype) {
        return request(resourcePath(doctype) + "/saved-filters").then(unwrapData);
      },
      saveFilter: function (doctype, input) {
        return request(resourcePath(doctype) + "/saved-filters", { method: "POST", body: savedFilterBody(input || {}) }).then(unwrapData);
      },
      share: function (doctype, name, userId, permissions, options) {
        return request(resourceActionPath(doctype, name, "shares"), { method: "POST", body: Object.assign({ userId: userId, permissions: permissions || ["read"] }, versionBody(options)) }).then(unwrapData);
      },
      shares: function (doctype, name) {
        return request(resourceActionPath(doctype, name, "shares")).then(unwrapData);
      },
      submit: function (doctype, name, options) {
        return request(resourcePath(doctype, name) + "/submit", { method: "POST", body: versionBody(options) }).then(unwrapData);
      },
      tag: function (doctype, name, tag, options) {
        return request(resourceActionPath(doctype, name, "tags"), { method: "POST", body: Object.assign({ tag: tag }, versionBody(options)) }).then(unwrapData);
      },
      tags: function (doctype, name) {
        return request(resourceActionPath(doctype, name, "tags")).then(unwrapData);
      },
      timeline: function (doctype, name, options) {
        return request(withQuery(resourceActionPath(doctype, name, "timeline"), timelineParams(options || {}))).then(unwrapData);
      },
      merge: function (doctype, name, input) {
        return request(resourcePath(doctype, name) + "/merge", { method: "POST", body: input || {} }).then(unwrapData);
      },
      transition: function (doctype, name, action, options) {
        return request(resourcePath(doctype, name) + "/transition/" + encodePart(action), { method: "POST", body: versionBody(options) }).then(unwrapData);
      },
      unassign: function (doctype, name, assignee, options) {
        return request(resourceMemberPath(doctype, name, "assignments", assignee), { method: "DELETE", body: versionBody(options) }).then(unwrapData);
      },
      unfollow: function (doctype, name, follower, options) {
        return request(resourceMemberPath(doctype, name, "followers", follower), { method: "DELETE", body: versionBody(options) }).then(unwrapData);
      },
      unshare: function (doctype, name, userId, options) {
        return request(resourceMemberPath(doctype, name, "shares", userId), { method: "DELETE", body: versionBody(options) }).then(unwrapData);
      },
      untag: function (doctype, name, tag, options) {
        return request(resourceMemberPath(doctype, name, "tags", tag), { method: "DELETE", body: versionBody(options) }).then(unwrapData);
      },
      update: function (doctype, name, data, options) {
        return request(resourcePath(doctype, name), { method: "PUT", body: commandBody(data, options) }).then(unwrapData);
      }
    })
  }));
  ready(currentFormBinding);
  ready(hydrateFileUploadForms);
  ready(hydrateCompoundFilterBuilders);
  ready(hydrateReportFormulaBuilders);
  ready(hydratePresencePanels);
}());
`;
}
