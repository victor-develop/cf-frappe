/** Script-tag dataset parsing (data-cf-frappe-runtime="desk" bootstrap attributes). */

export interface DeskPageContext {
  doctype: string | undefined;
  documentName: string | undefined;
  documentStatus?: string;
  documentVersion?: number;
  realtimeRoute: string | undefined;
  script: string | undefined;
  scope: string | undefined;
  tenantId: string | undefined;
}

export interface ContextScriptSource {
  dataset?: Record<string, string | undefined>;
}

export function runtimeScript(): ContextScriptSource | null {
  return document.querySelector<HTMLScriptElement>('script[data-cf-frappe-runtime="desk"]');
}

export function pageContext(script?: ContextScriptSource | null): DeskPageContext {
  const source = script || (document.currentScript as ContextScriptSource | null) || runtimeScript();
  const dataset: Record<string, string | undefined> = source && source.dataset ? source.dataset : {};
  const documentVersion = Number(dataset.documentVersion);
  const context: DeskPageContext = {
    doctype: dataset.doctype,
    documentName: dataset.documentName,
    realtimeRoute: dataset.realtimeRoute,
    script: dataset.cfFrappeScript,
    scope: dataset.scope,
    tenantId: dataset.tenantId
  };
  if (dataset.documentStatus !== undefined) {
    context.documentStatus = dataset.documentStatus;
  }
  if (Number.isInteger(documentVersion) && documentVersion >= 0) {
    context.documentVersion = documentVersion;
  }
  return context;
}

export function ready(callback: () => void): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", callback, { once: true });
    return;
  }
  callback();
}
