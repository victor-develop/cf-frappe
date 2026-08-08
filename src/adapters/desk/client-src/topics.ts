/** Realtime topic builders ported from the legacy desk client string. */

import { encodePart } from "./url.js";

export interface RealtimeTopicOptions {
  tenantId?: string;
  userId?: string;
  document?: { tenantId?: string };
  [key: string]: unknown;
}

export function documentTopic(tenantId: string, doctype: string, name: string): string {
  return `document:${encodePart(tenantId)}:${encodePart(doctype)}:${encodePart(name)}`;
}

export function doctypeTopic(tenantId: string, doctype: string): string {
  return `doctype:${encodePart(tenantId)}:${encodePart(doctype)}`;
}

export function tenantTopic(tenantId: string): string {
  return `tenant:${encodePart(tenantId)}`;
}

export function userTopic(tenantId: string, userId: string): string {
  return `user:${encodePart(tenantId)}:${encodePart(userId)}`;
}

export function tenantIdFromOptions(options: RealtimeTopicOptions | undefined, label: string): string {
  const tenantId = options && (options.tenantId || (options.document && options.document.tenantId));
  if (!tenantId) {
    throw new Error(`tenantId is required for ${label} realtime subscriptions`);
  }
  return tenantId;
}

export function doctypeTopicFromOptions(doctype: string, options?: RealtimeTopicOptions): string {
  return doctypeTopic(tenantIdFromOptions(options, "doctype"), doctype);
}

export function documentTopicFromOptions(doctype: string, name: string, options?: RealtimeTopicOptions): string {
  return documentTopic(tenantIdFromOptions(options, "document"), doctype, name);
}

export function tenantTopicFromOptions(options?: RealtimeTopicOptions): string {
  return tenantTopic(tenantIdFromOptions(options, "tenant"));
}

export function userTopicFromOptions(userId: string | undefined, options?: RealtimeTopicOptions): string {
  const resolvedUserId = userId || options?.userId;
  if (!resolvedUserId) {
    throw new Error("userId is required for user realtime subscriptions");
  }
  return userTopic(tenantIdFromOptions(options, "user"), resolvedUserId);
}
