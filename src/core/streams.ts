import type { DocTypeName, DocumentName, StreamName, TenantId } from "./types";

export function documentStream(tenantId: TenantId, doctype: DocTypeName, name: DocumentName): StreamName {
  return `${escapePart(tenantId)}:${escapePart(doctype)}:${escapePart(name)}`;
}

export function escapePart(value: string): string {
  return encodeURIComponent(value).replaceAll(".", "%2E");
}
