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

  function savedFilterBody(input) {
    return withoutKeys(input, ["id"]);
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
    linkOptions: function (doctype, field, params) {
      return request(withQuery("/api/link-options/" + encodePart(doctype) + "/" + encodePart(field), params || {})).then(unwrapData);
    },
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
      }
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
