import { CHILD_TABLE_ROW_INDEX_FIELD } from "../../core/types.js";

export const DESK_CLIENT_SCRIPT_PATH = "/desk/client.js";

export function renderDeskClientScript(): string {
  return `(function () {
  "use strict";

  var root = window;
  var childRowIndexField = ${JSON.stringify(CHILD_TABLE_ROW_INDEX_FIELD)};
  var lockedValueProperty = "__cfFrappeLockedValue";
  var readOnlyProperty = "__cfFrappeReadOnly";
  var softDisabledProperty = "__cfFrappeSoftDisabled";

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
      if (value !== undefined && value !== null) {
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
      if (key !== "filters" && value !== undefined && value !== null) {
        params[key] = value;
      }
    });
    Object.entries((options && options.filters) || {}).forEach(function (entry) {
      appendFilterParams(params, entry[0], entry[1]);
    });
    return params;
  }

  function appendFilterParams(params, field, value) {
    if (value === undefined || value === null) {
      return;
    }
    if (isPlainObject(value)) {
      Object.entries(value).forEach(function (entry) {
        if (entry[1] !== undefined && entry[1] !== null) {
          params["filter_" + field + (entry[0] === "eq" ? "" : "__" + entry[0])] = entry[1];
        }
      });
      return;
    }
    params["filter_" + field] = value;
  }

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
  }

  async function request(path, options) {
    var init = options || {};
    var headers = new Headers(init.headers || {});
    var body = init.body;
    if (isJsonBody(body)) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(body);
    }
    var response = await fetch(path, Object.assign({}, init, {
      body: body,
      credentials: init.credentials || "same-origin",
      headers: headers
    }));
    var contentType = response.headers.get("content-type") || "";
    var payload = contentType.indexOf("application/json") >= 0 ? await response.json() : await response.text();
    if (!response.ok) {
      var error = new Error((payload && payload.error && payload.error.message) || response.statusText);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function resourcePath(doctype, name) {
    return "/api/resource/" + encodePart(doctype) + (name === undefined ? "" : "/" + encodePart(name));
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

  function notificationActionPath(notificationId, action, options) {
    return withQuery("/api/notifications/" + encodePart(notificationId) + "/" + action, notificationCommandParams(options || {}));
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

  function userPermissionPath(userId, options) {
    return withQuery("/api/user-permissions/" + encodePart(userId), tenantParams(options || {}));
  }

  function dataPatchPath(patchId, action) {
    return "/api/data-patches" + (patchId === undefined ? "" : "/" + encodePart(patchId)) + (action === undefined ? "" : "/" + action);
  }

  function reportBuilderPath(doctype, id, action) {
    return "/api/report-builder/" + encodePart(doctype) + (id === undefined ? "" : "/" + encodePart(id)) + (action === undefined ? "" : "/" + action);
  }

  function auditDeletedPath(doctype, name, options) {
    return withQuery("/api/audit/deleted/" + encodePart(doctype) + "/" + encodePart(name), tenantParams(options || {}));
  }

  function printDocumentPath(format, name) {
    return "/api/print/" + encodePart(format) + "/" + encodePart(name);
  }

  function printFormatPath(format) {
    return "/api/meta/print-formats" + (format === undefined ? "" : "/" + encodePart(format));
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

  function customFieldBody(field, options) {
    var bodyField = isPlainObject(field) ? withoutKeys(field, ["expectedVersion"]) : field;
    return Object.assign({ field: bodyField }, versionBody(options));
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
    return {
      doctype: dataset.doctype,
      documentName: dataset.documentName,
      realtimeRoute: dataset.realtimeRoute,
      script: dataset.cfFrappeScript,
      scope: dataset.scope,
      tenantId: dataset.tenantId
    };
  }

  function ready(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
      return;
    }
    callback();
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
    var binding = {
      context: pageContext,
      dirty: false,
      doc: readFormData(form),
      form: form,
      submitting: false,
      validated: true
    };
    binding.frm = createFrm(binding);
    attachFieldListeners(binding);
    form.addEventListener("submit", function (event) {
      if (binding.submitting) {
        return;
      }
      if (!isSaveSubmit(event)) {
        return;
      }
      syncFormData(binding);
      binding.validated = true;
      binding.frm.validated = true;
      var valid = triggerFormEvent(binding, "validate") !== false && binding.frm.validated !== false && binding.validated !== false;
      var beforeSave = valid ? triggerFormEvent(binding, "before_save") !== false : false;
      if (!valid || !beforeSave || binding.frm.validated === false || binding.validated === false) {
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
      save: function () {
        binding.validated = true;
        frm.validated = true;
        if (
          triggerFormEvent(binding, "validate") === false ||
          frm.validated === false ||
          binding.validated === false ||
          triggerFormEvent(binding, "before_save") === false ||
          frm.validated === false ||
          binding.validated === false
        ) {
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
      }
    };
    return frm;
  }

  function attachFieldListeners(binding) {
    Array.prototype.forEach.call(binding.form.querySelectorAll("[name]"), function (field) {
      var fieldname = field.name;
      field.addEventListener("change", function () {
        if (restoreLockedFieldValue(field)) {
          return;
        }
        syncFormData(binding);
        binding.frm.dirty();
        triggerFormEvent(binding, fieldname);
      });
      field.addEventListener("input", function () {
        if (restoreLockedFieldValue(field)) {
          return;
        }
        syncFormData(binding);
        binding.frm.dirty();
      });
    });
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

  function fieldValue(field) {
    if (field.type === "checkbox") {
      return Boolean(field.checked);
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
    setPresencePanelState(panel, "loading", "Checking active collaborators.", "Checking active collaborators.");
    realtimePresenceDocument(doctype, documentName, Object.assign({ tenantId: tenantId }, realtimeRoute ? { realtimeRoute: realtimeRoute } : {}))
      .then(function (snapshot) {
        var labels = presenceConnectionLabels(snapshot && snapshot.connections);
        var count = labels.length;
        setPresencePanelState(
          panel,
          "ready",
          count === 1 ? "1 active collaborator" : String(count) + " active collaborators",
          count === 0 ? "No active collaborators are viewing this document." : labels.join(", ")
        );
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
    linkOptions: function (doctype, field, params) {
      return request(withQuery("/api/link-options/" + encodePart(doctype) + "/" + encodePart(field), params || {})).then(unwrapData);
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
      retry: function (patchId) {
        return request(dataPatchPath(patchId, "retry"), { method: "POST" }).then(unwrapData);
      },
      status: function () {
        return request(dataPatchPath()).then(unwrapData);
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
    files: Object.freeze({
      bulkDelete: function (files) {
        return request("/api/files/delete", { method: "POST", body: bulkFilesBody(files) }).then(unwrapData);
      },
      bulkUpdateMetadata: function (files, input) {
        return request("/api/files/bulk-metadata", { method: "POST", body: bulkFilesBody(files, input) }).then(unwrapData);
      },
      completeDirectUpload: function (name, options) {
        return request(filePath(name, "complete-upload"), { method: "POST", body: versionBody(options) }).then(unwrapData);
      },
      contentUrl: function (name) {
        return filePath(name, "content");
      },
      delete: function (name, options) {
        return request(withQuery(filePath(name), versionBody(options)), { method: "DELETE" }).then(unwrapData);
      },
      list: function (options) {
        return request(withQuery("/api/files", fileListParams(options || {}))).then(unwrapData);
      },
      prepareDirectUpload: function (input) {
        return request("/api/files/direct-upload", { method: "POST", body: input || {} });
      },
      previewUrl: function (name) {
        return filePath(name, "preview");
      },
      updateMetadata: function (name, input, options) {
        return request(filePath(name), { method: "PATCH", body: commandBody(input, options) }).then(unwrapData);
      },
      upload: function (body, options) {
        return request(withQuery("/api/files", fileUploadParams(options || {})), {
          method: "POST",
          body: body,
          headers: fileUploadHeaders(options || {})
        });
      }
    }),
    meta: Object.freeze({
      doctype: function (doctype) {
        return request("/api/meta/doctypes/" + encodePart(doctype)).then(unwrapData);
      },
      doctypes: function () {
        return request("/api/meta/doctypes").then(unwrapData);
      },
      listView: function (doctype) {
        return request("/api/meta/doctypes/" + encodePart(doctype) + "/list-view").then(unwrapData);
      },
      reports: function () {
        return request("/api/meta/reports").then(unwrapData);
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
      html: function (format, name) {
        return request(printDocumentPath(format, name));
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
    report: Object.freeze({
      csvUrl: function (report, options) {
        return withQuery("/api/report/" + encodePart(report) + "/export.csv", resourceListParams(options || {}));
      },
      get: function (report) {
        return request("/api/meta/reports/" + encodePart(report)).then(unwrapData);
      },
      list: function () {
        return request("/api/meta/reports").then(unwrapData);
      },
      run: function (report, options) {
        return request(withQuery("/api/report/" + encodePart(report) + "/run", resourceListParams(options || {})));
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
        return request(withQuery("/api/roles", tenantParams(options || {}))).then(unwrapData);
      }
    }),
    request: request,
    msgprint: msgprint,
    throw: throwMessage,
    ui: Object.freeze({
      msgprint: msgprint
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
  ready(hydratePresencePanels);
}());
`;
}
