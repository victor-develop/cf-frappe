/**
 * Realtime WebSocket subscribe/dispatch + collaboration messages, ported from the
 * legacy desk client string (client.ts: realtime topic URL builders, subscribe,
 * message dispatch, field-edit / shared-draft message builders).
 *
 * Contributes the `cfFrappe.realtime` namespace group at import time. The
 * collaboration message builders are exported (`collaborationMessageApi`) so the
 * merge-planning module / Flip agent can compose the full `cfFrappe.collaboration`
 * extension (this module deliberately does not own `collaboration.mergePlan`).
 */

import { registerNamespaceContribution } from "./boot.js";
import {
  FIELD_EDIT_MESSAGE_TYPE,
  REALTIME_COLLABORATION_MESSAGE_TYPE,
  SHARED_DRAFT_MESSAGE_TYPE
} from "./constants.js";
import { pageContext } from "./context.js";
import { request, unwrapData, withQuery } from "./http.js";
import type {
  CollaborationNamespaceExtension,
  RealtimeNamespaceExtension,
  RealtimeSubscribeHandlers,
  RealtimeTopicOptions,
  UnknownRecord
} from "./seams.js";
import {
  doctypeTopicFromOptions,
  documentTopicFromOptions,
  tenantTopicFromOptions,
  userTopicFromOptions
} from "./topics.js";
import { isPlainObject } from "./url.js";

/** Options accepted by the realtime helpers on top of the shared topic options. */
export interface RealtimeConnectOptions extends RealtimeTopicOptions {
  realtimeRoute?: string;
  replayAfter?: number | string | null;
  replayLimit?: number | string | null;
  protocols?: string | string[];
}

/** Minimal socket surface used by the message senders (real WebSocket or a fake). */
export interface RealtimeSendCapableSocket {
  send(data: string): void;
}

export interface RealtimeSocketLike extends RealtimeSendCapableSocket {
  close(code?: number, reason?: string): void;
  addEventListener?(type: string, listener: (event: unknown) => void): void;
}

export interface RealtimeSubscription {
  close(code?: number, reason?: string): void;
  send(message: unknown): unknown;
  sendFieldEdit(field: unknown, input?: unknown): UnknownRecord;
  sendSharedDraft(input?: unknown): UnknownRecord;
  socket: RealtimeSocketLike;
  topic: string;
  url: string;
}

function connectOptions(options?: RealtimeTopicOptions): RealtimeConnectOptions | undefined {
  return options as RealtimeConnectOptions | undefined;
}

export function realtimeRouteFromOptions(options?: RealtimeTopicOptions): string {
  let route = (connectOptions(options)?.realtimeRoute || pageContext().realtimeRoute || "/api/realtime") as string;
  if (route.charAt(0) !== "/") {
    route = `/${route}`;
  }
  return route.length > 1 ? route.replace(/\/$/, "") : route;
}

export function realtimeUrl(topic: string, options?: RealtimeTopicOptions): URL {
  const opts = connectOptions(options);
  const url = new URL(realtimeRouteFromOptions(options), window.location.href);
  url.searchParams.set("topic", topic);
  if (opts && opts.replayAfter !== undefined && opts.replayAfter !== null) {
    url.searchParams.set("replayAfter", String(opts.replayAfter));
  }
  if (opts && opts.replayLimit !== undefined && opts.replayLimit !== null) {
    url.searchParams.set("replayLimit", String(opts.replayLimit));
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}

export function realtimePresenceUrl(topic: string, options?: RealtimeTopicOptions): string {
  const route = realtimeRouteFromOptions(options);
  return withQuery(`${route === "/" ? "" : route}/presence`, { topic });
}

export function realtimePresence(topic: string, options?: RealtimeTopicOptions): Promise<unknown> {
  return request(realtimePresenceUrl(topic, options)).then(unwrapData);
}

export function realtimePresenceDocument(
  doctype: string,
  name: string,
  options?: RealtimeTopicOptions
): Promise<unknown> {
  return realtimePresence(documentTopicFromOptions(doctype, name, options), options);
}

function addSocketListener(socket: RealtimeSocketLike, type: string, listener: (event: unknown) => void): void {
  if (typeof socket.addEventListener === "function") {
    socket.addEventListener(type, listener);
    return;
  }
  (socket as unknown as Record<string, unknown>)[`on${type}`] = listener;
}

function callRealtimeHandler(handler: unknown, args: readonly unknown[]): void {
  if (typeof handler === "function") {
    (handler as (...handlerArgs: unknown[]) => unknown).apply(null, args as unknown[]);
  }
}

function openSocket(url: string | URL, options?: RealtimeTopicOptions): RealtimeSocketLike {
  return new WebSocket(url, connectOptions(options)?.protocols) as unknown as RealtimeSocketLike;
}

export function realtimeSubscribe(
  topic: string,
  handlers?: RealtimeSubscribeHandlers,
  options?: RealtimeTopicOptions
): RealtimeSubscription {
  const url = realtimeUrl(topic, options).toString();
  const socket = openSocket(url, options);
  const subscription: RealtimeSubscription = {
    close(code?: number, reason?: string): void {
      socket.close(code, reason);
    },
    send(message: unknown): unknown {
      socket.send(typeof message === "string" ? message : JSON.stringify(message));
      return message;
    },
    sendFieldEdit(field: unknown, input?: unknown): UnknownRecord {
      return realtimeSendFieldEdit(socket, field, input);
    },
    sendSharedDraft(input?: unknown): UnknownRecord {
      return realtimeSendSharedDraft(socket, input);
    },
    socket,
    topic,
    url
  };
  const callbacks = handlers || {};
  addSocketListener(socket, "message", (message) => {
    handleRealtimeMessage(message, subscription, callbacks);
  });
  addSocketListener(socket, "open", (event) => {
    callRealtimeHandler(callbacks.open, [event, subscription]);
  });
  addSocketListener(socket, "close", (event) => {
    callRealtimeHandler(callbacks.close, [event, subscription]);
  });
  addSocketListener(socket, "error", (event) => {
    callRealtimeHandler(callbacks.error, [event, subscription]);
  });
  return subscription;
}

function handleRealtimeMessage(
  rawMessage: unknown,
  subscription: RealtimeSubscription,
  callbacks: RealtimeSubscribeHandlers
): void {
  const raw = (rawMessage as { data?: unknown } | null | undefined)?.data;
  let parsed: unknown;
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
  const message = parsed as UnknownRecord;
  if (message.type === "cf-frappe.realtime.connected") {
    callRealtimeHandler(callbacks.connected, [message, subscription]);
    return;
  }
  if (message.type === "cf-frappe.realtime.event" && message.event) {
    dispatchRealtimeEvent(message.event, message, subscription, callbacks);
    return;
  }
  if (message.type === REALTIME_COLLABORATION_MESSAGE_TYPE && message.event) {
    dispatchRealtimeCollaborationEvent(message.event, message, subscription, callbacks);
    return;
  }
  if (message.type === "cf-frappe.realtime.replay" && message.replay) {
    const replay = message.replay as UnknownRecord;
    callRealtimeHandler(callbacks.replay, [replay, message, subscription]);
    const events = Array.isArray(replay.events) ? (replay.events as readonly unknown[]) : [];
    events.forEach((entry) => {
      const replayEntry = entry as UnknownRecord | null | undefined;
      if (replayEntry && replayEntry.event) {
        dispatchRealtimeEvent(
          replayEntry.event,
          Object.assign({}, message, {
            type: "cf-frappe.realtime.event",
            cursor: replayEntry.cursor,
            event: replayEntry.event
          }),
          subscription,
          callbacks
        );
      }
    });
    return;
  }
  if (message.type === "cf-frappe.realtime.presence" && message.presence) {
    callRealtimeHandler(callbacks.presence, [message.presence, message, subscription]);
  }
}

function dispatchRealtimeEvent(
  event: unknown,
  message: UnknownRecord,
  subscription: RealtimeSubscription,
  callbacks: RealtimeSubscribeHandlers
): void {
  callRealtimeHandler(callbacks.event, [event, message, subscription]);
  const payload = (event as UnknownRecord | null | undefined)?.payload as UnknownRecord | undefined;
  if (payload && payload.kind === "DocumentUserNotification") {
    callRealtimeHandler(callbacks.notification, [payload, event, message, subscription]);
  }
}

function dispatchRealtimeCollaborationEvent(
  event: unknown,
  message: UnknownRecord,
  subscription: RealtimeSubscription,
  callbacks: RealtimeSubscribeHandlers
): void {
  callRealtimeHandler(callbacks.collaboration, [event, message, subscription]);
  const payload = (event as UnknownRecord | null | undefined)?.payload as UnknownRecord | undefined;
  if (payload && payload.kind === "DocumentFieldEditIntent") {
    callRealtimeHandler(callbacks.fieldEdit, [payload, event, message, subscription]);
  }
  if (payload && payload.kind === "DocumentSharedDraftPatch") {
    callRealtimeHandler(callbacks.sharedDraft, [payload, event, message, subscription]);
  }
}

export function realtimeFieldEditMessage(field: unknown, input?: unknown): UnknownRecord {
  const options: UnknownRecord = isPlainObject(input) ? input : input === undefined ? {} : { value: input };
  const message: UnknownRecord = {
    type: FIELD_EDIT_MESSAGE_TYPE,
    field: String(field || "").trim(),
    editing: options.editing === false ? false : true
  };
  if (Object.prototype.hasOwnProperty.call(options, "value")) {
    message.value = options.value;
  }
  return message;
}

export function realtimeSendFieldEdit(
  socket: RealtimeSendCapableSocket,
  field: unknown,
  input?: unknown
): UnknownRecord {
  const message = realtimeFieldEditMessage(field, input);
  socket.send(JSON.stringify(message));
  return message;
}

export function realtimeSharedDraftMessage(input?: unknown): UnknownRecord {
  const options: UnknownRecord = isPlainObject(input) ? input : {};
  const message: UnknownRecord = {
    type: SHARED_DRAFT_MESSAGE_TYPE
  };
  if (Number.isInteger(options.baseVersion) && (options.baseVersion as number) >= 0) {
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

export function realtimeSendSharedDraft(socket: RealtimeSendCapableSocket, input?: unknown): UnknownRecord {
  const message = realtimeSharedDraftMessage(input);
  socket.send(JSON.stringify(message));
  return message;
}

/** The full `cfFrappe.realtime` namespace group (behavior parity with the legacy string). */
export function realtimeNamespaceExtension(): RealtimeNamespaceExtension {
  return {
    connect: (topic, options) => openSocket(realtimeUrl(topic, options), options),
    doctype: (doctype, options) => openSocket(realtimeUrl(doctypeTopicFromOptions(doctype, options), options), options),
    doctypeUrl: (doctype, options) => realtimeUrl(doctypeTopicFromOptions(doctype, options), options).toString(),
    document: (doctype, name, options) =>
      openSocket(realtimeUrl(documentTopicFromOptions(doctype, name, options), options), options),
    documentUrl: (doctype, name, options) =>
      realtimeUrl(documentTopicFromOptions(doctype, name, options), options).toString(),
    tenant: (options) => openSocket(realtimeUrl(tenantTopicFromOptions(options), options), options),
    tenantUrl: (options) => realtimeUrl(tenantTopicFromOptions(options), options).toString(),
    user: (userId, options) => openSocket(realtimeUrl(userTopicFromOptions(userId, options), options), options),
    userUrl: (userId, options) => realtimeUrl(userTopicFromOptions(userId, options), options).toString(),
    presence: realtimePresence,
    presenceDoctype: (doctype, options) => realtimePresence(doctypeTopicFromOptions(doctype, options), options),
    presenceDocument: (doctype, name, options) => realtimePresenceDocument(doctype, name, options),
    presenceTenant: (options) => realtimePresence(tenantTopicFromOptions(options), options),
    presenceUrl: realtimePresenceUrl,
    presenceUser: (userId, options) => realtimePresence(userTopicFromOptions(userId, options), options),
    subscribe: (topic, handlers, options) => realtimeSubscribe(topic, handlers, options),
    subscribeDoctype: (doctype, handlers, options) =>
      realtimeSubscribe(doctypeTopicFromOptions(doctype, options), handlers, options),
    subscribeDocument: (doctype, name, handlers, options) =>
      realtimeSubscribe(documentTopicFromOptions(doctype, name, options), handlers, options),
    subscribeTenant: (handlers, options) => realtimeSubscribe(tenantTopicFromOptions(options), handlers, options),
    subscribeUser: (userId, handlers, options) =>
      realtimeSubscribe(userTopicFromOptions(userId, options), handlers, options),
    url: (topic, options) => realtimeUrl(topic, options).toString()
  };
}

/**
 * Collaboration message builders owned by this module (everything on
 * `cfFrappe.collaboration` except `mergePlan`, which belongs to the merge-planning
 * module). The Flip agent composes the frozen collaboration extension as
 * `{ ...collaborationMessageApi, mergePlan: documentMergePlan }`.
 */
export const collaborationMessageApi: Omit<CollaborationNamespaceExtension, "mergePlan"> = {
  fieldEditMessage: realtimeFieldEditMessage,
  sendFieldEdit: (subscription: unknown, field: string, input?: UnknownRecord): unknown => {
    const target = subscription as RealtimeSubscription | null | undefined;
    if (!target || typeof target.sendFieldEdit !== "function") {
      return realtimeFieldEditMessage(field, input);
    }
    return target.sendFieldEdit(field, input);
  },
  sendSharedDraft: (subscription: unknown, input?: UnknownRecord): unknown => {
    const target = subscription as RealtimeSubscription | null | undefined;
    if (!target || typeof target.sendSharedDraft !== "function") {
      return realtimeSharedDraftMessage(input);
    }
    return target.sendSharedDraft(input);
  },
  sharedDraftMessage: realtimeSharedDraftMessage
};

/** Registers the `cfFrappe.realtime` namespace contribution (idempotent to re-run after resetRegistries). */
export function registerRealtimeNamespace(): void {
  registerNamespaceContribution(() => ({ realtime: realtimeNamespaceExtension() }));
}

registerRealtimeNamespace();
