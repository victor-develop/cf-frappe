export const DESK_CLIENT_SCRIPT_PATH = "/desk/client.js";

export function renderDeskClientScript(): string {
  return `(function () {
  "use strict";

  var root = window;

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
      var value = entry[1];
      if (value !== undefined && value !== null) {
        params["filter_" + entry[0]] = value;
      }
    });
    return params;
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

  function context(script) {
    var source = script || document.currentScript;
    var dataset = source && source.dataset ? source.dataset : {};
    return {
      doctype: dataset.doctype,
      documentName: dataset.documentName,
      script: dataset.cfFrappeScript,
      scope: dataset.scope,
      tenantId: dataset.tenantId
    };
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
    meta: Object.freeze({
      doctype: function (doctype) {
        return request("/api/meta/doctypes/" + encodePart(doctype)).then(unwrapData);
      },
      doctypes: function () {
        return request("/api/meta/doctypes").then(unwrapData);
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
