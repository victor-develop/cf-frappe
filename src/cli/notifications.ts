import { requestRemoteAdminPayload, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type NotificationRemoteAction = "dismiss" | "list" | "read";

export type NotificationHeaderOption = RemoteHeaderOption;

export interface NotificationRemoteCommand {
  readonly kind: "notifications";
  readonly action: NotificationRemoteAction;
  readonly url: string;
  readonly headers: readonly NotificationHeaderOption[];
  readonly id?: string;
  readonly user?: string;
  readonly limit?: number;
  readonly unreadOnly?: boolean;
  readonly includeDismissed?: boolean;
}

export type NotificationRemoteIo = RemoteAdminIo;

export class NotificationRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationRemoteError";
  }
}

interface UserNotificationInboxResponse {
  readonly tenantId?: string;
  readonly userId?: string;
  readonly limit?: number;
  readonly unreadCount?: number;
  readonly filters?: unknown;
  readonly notifications?: unknown;
}

interface UserNotificationRecordResponse {
  readonly id?: string;
  readonly tenantId?: string;
  readonly recipientId?: string;
  readonly sourceEventId?: string;
  readonly eventType?: string;
  readonly payloadKind?: string;
  readonly doctype?: string;
  readonly documentName?: string;
  readonly actorId?: string;
  readonly subject?: string;
  readonly ruleName?: string;
  readonly read?: boolean;
  readonly dismissed?: boolean;
  readonly createdAt?: string;
  readonly readAt?: string;
  readonly readBy?: string;
  readonly dismissedAt?: string;
  readonly dismissedBy?: string;
}

interface NotificationFiltersResponse {
  readonly unreadOnly?: boolean;
  readonly includeDismissed?: boolean;
}

interface RemoteDataPayload {
  readonly data?: unknown;
}

export async function runRemoteNotificationCommand(
  command: NotificationRemoteCommand,
  io: NotificationRemoteIo = {}
): Promise<string> {
  if (command.action === "list") {
    const query = listQuery(command);
    const data = await requestRemoteNotifications(command, io, {
      method: "GET",
      path: "/api/notifications",
      ...(query === undefined ? {} : { query })
    });
    return formatNotificationInbox(command.url, objectData<UserNotificationInboxResponse>(data.data, "notification inbox"));
  }

  const query = actionQuery(command);
  const data = await requestRemoteNotifications(command, io, {
    method: "POST",
    path: `/api/notifications/${encodeURIComponent(requiredNotificationId(command))}/${command.action}`,
    ...(query === undefined ? {} : { query })
  });
  return formatNotification(
    command.url,
    objectData<UserNotificationRecordResponse>(data.data, "notification"),
    command.action === "read" ? "Read notification" : "Dismissed notification"
  );
}

function requestRemoteNotifications(
  command: NotificationRemoteCommand,
  io: NotificationRemoteIo,
  request: {
    readonly method: "GET" | "POST";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<RemoteDataPayload> {
  return requestRemoteAdminPayload<RemoteDataPayload, NotificationRemoteError>(command, io, request, {
    error: NotificationRemoteError,
    fetchLabel: "remote notification commands",
    resourceLabel: "Remote notifications",
    urlLabel: "Remote notifications"
  });
}

function listQuery(command: NotificationRemoteCommand): URLSearchParams | undefined {
  const params = new URLSearchParams();
  if (command.user !== undefined) {
    params.set("user", command.user);
  }
  if (command.limit !== undefined) {
    params.set("limit", String(command.limit));
  }
  if (command.unreadOnly === true) {
    params.set("unread", "1");
  }
  if (command.includeDismissed === true) {
    params.set("include_dismissed", "1");
  }
  return params.size === 0 ? undefined : params;
}

function actionQuery(command: NotificationRemoteCommand): URLSearchParams | undefined {
  if (command.user === undefined) {
    return undefined;
  }
  const params = new URLSearchParams();
  params.set("user", command.user);
  return params;
}

function formatNotificationInbox(baseUrl: string, inbox: UserNotificationInboxResponse): string {
  const notifications = notificationArray(inbox.notifications, "notification inbox");
  const filters = filtersObject(inbox.filters);
  return [
    `Notifications at ${baseUrl}`,
    `User: ${inbox.userId ?? "(unknown)"} Tenant: ${inbox.tenantId ?? "(unknown)"} Limit: ${String(inbox.limit ?? notifications.length)} Unread: ${String(inbox.unreadCount ?? 0)}`,
    `Filters: ${filterLabel(filters)}`,
    ...notificationLines(notifications),
    ""
  ].join("\n");
}

function formatNotification(baseUrl: string, notification: UserNotificationRecordResponse, title: string): string {
  return [
    `${title} at ${baseUrl}`,
    notificationLine(notification),
    notificationDetailLine(notification),
    ""
  ].join("\n");
}

function notificationLines(notifications: readonly UserNotificationRecordResponse[]): readonly string[] {
  if (notifications.length === 0) {
    return ["- (none)"];
  }
  return notifications.flatMap((notification) => [
    notificationLine(notification),
    notificationDetailLine(notification)
  ]);
}

function notificationLine(notification: UserNotificationRecordResponse): string {
  const read = notification.read === true ? "read" : "unread";
  const dismissed = notification.dismissed === true ? "dismissed" : "active";
  const documentLabel = `${notification.doctype ?? "(unknown)"}/${notification.documentName ?? "(unknown)"}`;
  const subject = notification.subject === undefined ? "" : ` - ${notification.subject}`;
  return `- ${notification.id ?? "(unknown)"} ${read} ${dismissed} ${documentLabel} ${notification.eventType ?? "(unknown)"}${subject}`;
}

function notificationDetailLine(notification: UserNotificationRecordResponse): string {
  return [
    `  actor=${notification.actorId ?? "(unknown)"}`,
    ...(notification.ruleName === undefined ? [] : [`rule=${notification.ruleName}`]),
    `created=${notification.createdAt ?? "(unknown)"}`,
    ...(notification.readAt === undefined ? [] : [`readAt=${notification.readAt}`]),
    ...(notification.readBy === undefined ? [] : [`readBy=${notification.readBy}`]),
    ...(notification.dismissedAt === undefined ? [] : [`dismissedAt=${notification.dismissedAt}`]),
    ...(notification.dismissedBy === undefined ? [] : [`dismissedBy=${notification.dismissedBy}`])
  ].join(" ");
}

function filterLabel(filters: NotificationFiltersResponse): string {
  return [
    filters.unreadOnly === true ? "unread" : "all",
    filters.includeDismissed === true ? "dismissed-included" : "active-only"
  ].join(" ");
}

function filtersObject(data: unknown): NotificationFiltersResponse {
  if (data === undefined) {
    return {};
  }
  if (isRecord(data)) {
    return data;
  }
  throw new NotificationRemoteError("Remote notification inbox response included malformed filters");
}

function notificationArray(data: unknown, label: string): readonly UserNotificationRecordResponse[] {
  if (data === undefined) {
    return [];
  }
  if (!Array.isArray(data)) {
    throw new NotificationRemoteError(`Remote ${label} response did not include a notifications array`);
  }
  if (!data.every(isRecord)) {
    throw new NotificationRemoteError(`Remote ${label} response included a malformed notification`);
  }
  return data as readonly UserNotificationRecordResponse[];
}

function objectData<T>(data: unknown, label: string): T {
  if (isRecord(data)) {
    return data as T;
  }
  throw new NotificationRemoteError(`Remote ${label} response did not include a data object`);
}

function requiredNotificationId(command: NotificationRemoteCommand): string {
  if (command.id === undefined) {
    throw new NotificationRemoteError(`Notification ${command.action} requires --id`);
  }
  return command.id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
