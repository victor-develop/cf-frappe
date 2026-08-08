import { pageContext, ready, runtimeScript } from "../../src/adapters/desk/client-src/context";

function installRuntimeScript(attributes: Record<string, string>): HTMLScriptElement {
  const script = document.createElement("script");
  script.setAttribute("data-cf-frappe-runtime", "desk");
  Object.entries(attributes).forEach(([name, value]) => {
    script.setAttribute(name, value);
  });
  document.body.appendChild(script);
  return script;
}

describe("client-src context", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("runtimeScript finds the desk bootstrap script tag", () => {
    expect(runtimeScript()).toBeNull();
    const script = installRuntimeScript({});
    expect(runtimeScript()).toBe(script);
  });

  it("pageContext reads the DOM script dataset (real attributes)", () => {
    installRuntimeScript({
      "data-doctype": "Task",
      "data-document-name": "T 1",
      "data-document-status": "Draft",
      "data-document-version": "3",
      "data-realtime-route": "/realtime",
      "data-cf-frappe-script": "desk",
      "data-scope": "form",
      "data-tenant-id": "acme"
    });
    expect(pageContext()).toEqual({
      doctype: "Task",
      documentName: "T 1",
      documentStatus: "Draft",
      documentVersion: 3,
      realtimeRoute: "/realtime",
      script: "desk",
      scope: "form",
      tenantId: "acme"
    });
  });

  it("pageContext prefers an explicit script source over the DOM", () => {
    installRuntimeScript({ "data-doctype": "FromDom" });
    const context = pageContext({ dataset: { doctype: "Explicit" } });
    expect(context.doctype).toBe("Explicit");
  });

  it("pageContext tolerates a source without a dataset", () => {
    const context = pageContext({} as { dataset?: Record<string, string | undefined> });
    expect(context.doctype).toBeUndefined();
    expect(context.tenantId).toBeUndefined();
  });

  it("pageContext returns undefined fields when no script exists", () => {
    const context = pageContext();
    expect(context).toEqual({
      doctype: undefined,
      documentName: undefined,
      realtimeRoute: undefined,
      script: undefined,
      scope: undefined,
      tenantId: undefined
    });
    expect("documentStatus" in context).toBe(false);
    expect("documentVersion" in context).toBe(false);
  });

  it("pageContext omits documentVersion for non-integer or negative values", () => {
    expect(pageContext({ dataset: { documentVersion: "abc" } }).documentVersion).toBeUndefined();
    expect(pageContext({ dataset: { documentVersion: "1.5" } }).documentVersion).toBeUndefined();
    expect(pageContext({ dataset: { documentVersion: "-1" } }).documentVersion).toBeUndefined();
    expect(pageContext({ dataset: { documentVersion: "0" } }).documentVersion).toBe(0);
  });

  it("pageContext omits documentStatus when the attribute is absent", () => {
    const context = pageContext({ dataset: { doctype: "Task" } });
    expect("documentStatus" in context).toBe(false);
  });

  it("ready runs immediately when the document is already parsed", () => {
    const callback = vi.fn();
    ready(callback);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("ready defers to DOMContentLoaded while the document is loading", () => {
    Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
    const callback = vi.fn();
    ready(callback);
    expect(callback).not.toHaveBeenCalled();
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(callback).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(callback).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(document, "readyState");
  });
});
