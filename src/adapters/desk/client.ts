import { CHILD_TABLE_ROW_INDEX_FIELD } from "../../core/types";

export const DESK_CLIENT_SCRIPT_PATH = "/desk/client.js";

export function renderDeskClientScript(): string {
  return `(function () {
  "use strict";

  var root = window;
  var childRowIndexField = ${JSON.stringify(CHILD_TABLE_ROW_INDEX_FIELD)};

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

  function versionBody(options) {
    return options && options.expectedVersion !== undefined ? { expectedVersion: options.expectedVersion } : {};
  }

  function commandBody(input, options) {
    var body = {};
    Object.entries(input || {}).forEach(function (entry) {
      if (entry[0] !== "expectedVersion") {
        body[entry[0]] = entry[1];
      }
    });
    return Object.assign(body, versionBody(options));
  }

  function documentTopic(tenantId, doctype, name) {
    return "document:" + encodePart(tenantId) + ":" + encodePart(doctype) + ":" + encodePart(name);
  }

  function documentTopicFromOptions(doctype, name, options) {
    var tenantId = options && (options.tenantId || (options.document && options.document.tenantId));
    if (!tenantId) {
      throw new Error("tenantId is required for document realtime subscriptions");
    }
    return documentTopic(tenantId, doctype, name);
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
        syncFormData(binding);
        binding.frm.dirty();
        triggerFormEvent(binding, fieldname);
      });
      field.addEventListener("input", function () {
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
    Array.prototype.forEach.call(form.querySelectorAll("[name]"), function (field) {
      if (field.name === fieldname) {
        if (field.type === "checkbox") {
          field.checked = Boolean(value);
        } else {
          field.value = value == null ? "" : String(value);
        }
      }
    });
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

  function realtimeUrl(topic) {
    var url = new URL("/api/realtime", root.location.href);
    url.searchParams.set("topic", topic);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url;
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
        return new WebSocket(realtimeUrl(topic), options && options.protocols);
      },
      document: function (doctype, name, options) {
        return new WebSocket(realtimeUrl(documentTopicFromOptions(doctype, name, options)), options && options.protocols);
      },
      documentUrl: function (doctype, name, options) {
        return realtimeUrl(documentTopicFromOptions(doctype, name, options)).toString();
      },
      url: function (topic) {
        return realtimeUrl(topic).toString();
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
    resource: Object.freeze({
      cancel: function (doctype, name, options) {
        return request(resourcePath(doctype, name) + "/cancel", { method: "POST", body: versionBody(options) }).then(unwrapData);
      },
      command: function (doctype, name, command, input, options) {
        return request(resourcePath(doctype, name) + "/command/" + encodePart(command), { method: "POST", body: commandBody(input, options) }).then(unwrapData);
      },
      create: function (doctype, data) {
        return request(resourcePath(doctype), { method: "POST", body: data || {} }).then(unwrapData);
      },
      delete: function (doctype, name, options) {
        return request(resourcePath(doctype, name), { method: "DELETE", body: versionBody(options) }).then(unwrapData);
      },
      get: function (doctype, name) {
        return request(resourcePath(doctype, name)).then(unwrapData);
      },
      list: function (doctype, options) {
        return request(withQuery(resourcePath(doctype), resourceListParams(options || {})));
      },
      submit: function (doctype, name, options) {
        return request(resourcePath(doctype, name) + "/submit", { method: "POST", body: versionBody(options) }).then(unwrapData);
      },
      transition: function (doctype, name, action, options) {
        return request(resourcePath(doctype, name) + "/transition/" + encodePart(action), { method: "POST", body: versionBody(options) }).then(unwrapData);
      },
      update: function (doctype, name, data, options) {
        return request(resourcePath(doctype, name), { method: "PUT", body: commandBody(data, options) }).then(unwrapData);
      }
    })
  }));
}());
`;
}
