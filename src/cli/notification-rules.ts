import { requestRemoteAdmin, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type NotificationRuleRemoteAction = "clear" | "disable" | "enable" | "get" | "list" | "save";

export type NotificationRuleHeaderOption = RemoteHeaderOption;

export type NotificationRuleRecipientOption =
  | {
      readonly kind: "documentOwner";
    }
  | {
      readonly kind: "field";
      readonly field: string;
    }
  | {
      readonly kind: "user";
      readonly userId: string;
    };

export interface NotificationRuleRemoteCommand {
  readonly kind: "notification-rules";
  readonly action: NotificationRuleRemoteAction;
  readonly url: string;
  readonly headers: readonly NotificationRuleHeaderOption[];
  readonly doctype: string;
  readonly tenant?: string;
  readonly ruleName?: string;
  readonly events?: readonly string[];
  readonly recipients?: readonly NotificationRuleRecipientOption[];
  readonly channels?: readonly string[];
  readonly subject?: string;
  readonly enabled?: boolean;
  readonly excludeActor?: boolean;
  readonly expectedVersion?: number;
}

export type NotificationRuleRemoteIo = RemoteAdminIo;

export class NotificationRuleRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationRuleRemoteError";
  }
}

interface NotificationRuleStateResponse {
  readonly tenantId?: string;
  readonly doctypeName?: string;
  readonly version?: number;
  readonly rules?: readonly NotificationRuleEntryResponse[];
}

interface NotificationRuleEntryResponse {
  readonly enabled?: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly rule: NotificationRuleResponse;
}

interface NotificationRuleResponse {
  readonly name: string;
  readonly enabled?: boolean;
  readonly events?: readonly string[];
  readonly recipients?: readonly NotificationRuleRecipientOption[];
  readonly channels?: readonly string[];
  readonly subject?: string;
  readonly excludeActor?: boolean;
}

export async function runRemoteNotificationRuleCommand(
  command: NotificationRuleRemoteCommand,
  io: NotificationRuleRemoteIo = {}
): Promise<string> {
  const query = tenantQuery(command);
  if (command.action === "list") {
    const data = await requestRemoteNotificationRule(command, io, {
      method: "GET",
      path: notificationRulesPath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatNotificationRules(command.url, data);
  }
  if (command.action === "get") {
    const data = await requestRemoteNotificationRule(command, io, {
      method: "GET",
      path: notificationRulesPath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatNotificationRules(command.url, singleRuleState(command, data), "Notification rule");
  }
  if (command.action === "clear") {
    const data = await requestRemoteNotificationRule(command, io, {
      body: mutationBody(command),
      method: "DELETE",
      path: notificationRulePath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatNotificationRules(command.url, data, "Cleared notification rule");
  }
  if (command.action === "enable" || command.action === "disable") {
    const current = await requestRemoteNotificationRule(command, io, {
      method: "GET",
      path: notificationRulesPath(command),
      ...(query === undefined ? {} : { query })
    });
    const data = await requestRemoteNotificationRule(command, io, {
      body: toggleBody(command, current, command.action === "enable"),
      method: "PUT",
      path: notificationRulePath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatNotificationRules(
      command.url,
      data,
      command.action === "enable" ? "Enabled notification rule" : "Disabled notification rule"
    );
  }
  const data = await requestRemoteNotificationRule(command, io, {
    body: saveBody(command),
    method: "PUT",
    path: notificationRulePath(command),
    ...(query === undefined ? {} : { query })
  });
  return formatNotificationRules(command.url, data, "Saved notification rule");
}

function requestRemoteNotificationRule(
  command: NotificationRuleRemoteCommand,
  io: NotificationRuleRemoteIo,
  request: {
    readonly body?: Record<string, unknown>;
    readonly method: "DELETE" | "GET" | "PUT";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<NotificationRuleStateResponse> {
  return requestRemoteAdmin<NotificationRuleStateResponse, NotificationRuleRemoteError>(command, io, request, {
    error: NotificationRuleRemoteError,
    fetchLabel: "remote notification-rule commands",
    resourceLabel: "Remote notification rules",
    urlLabel: "Remote notification rules"
  });
}

function notificationRulesPath(command: NotificationRuleRemoteCommand): string {
  return `/api/notification-rules/${encodeURIComponent(command.doctype)}`;
}

function notificationRulePath(command: NotificationRuleRemoteCommand): string {
  return `${notificationRulesPath(command)}/${encodeURIComponent(requiredRuleName(command))}`;
}

function tenantQuery(command: NotificationRuleRemoteCommand): URLSearchParams | undefined {
  if (command.tenant === undefined) {
    return undefined;
  }
  const params = new URLSearchParams();
  params.set("tenant", command.tenant);
  return params;
}

function saveBody(command: NotificationRuleRemoteCommand): Record<string, unknown> {
  return {
    rule: {
      events: [...requiredEvents(command)],
      recipients: [...requiredRecipients(command)],
      ...(command.channels === undefined || command.channels.length === 0 ? {} : { channels: [...command.channels] }),
      ...(command.enabled === undefined ? {} : { enabled: command.enabled }),
      ...(command.subject === undefined ? {} : { subject: command.subject }),
      ...(command.excludeActor === undefined ? {} : { excludeActor: command.excludeActor })
    },
    ...mutationBody(command)
  };
}

function toggleBody(
  command: NotificationRuleRemoteCommand,
  state: NotificationRuleStateResponse,
  enabled: boolean
): Record<string, unknown> {
  const ruleName = requiredRuleName(command);
  if (
    command.expectedVersion !== undefined &&
    state.version !== undefined &&
    state.version !== command.expectedVersion
  ) {
    throw new NotificationRuleRemoteError(
      `Expected notification rules at version ${String(command.expectedVersion)}, found ${String(state.version)}`
    );
  }
  const entry = (state.rules ?? []).find((item) => item.rule.name === ruleName);
  if (entry === undefined) {
    throw new NotificationRuleRemoteError(`Notification rule '${ruleName}' was not found in remote state`);
  }
  return {
    rule: {
      events: [...requiredResponseEvents(entry.rule, ruleName)],
      recipients: [...requiredResponseRecipients(entry.rule, ruleName)],
      ...(entry.rule.channels === undefined || entry.rule.channels.length === 0 ? {} : { channels: [...entry.rule.channels] }),
      enabled,
      ...(entry.rule.subject === undefined ? {} : { subject: entry.rule.subject }),
      ...(entry.rule.excludeActor === undefined ? {} : { excludeActor: entry.rule.excludeActor })
    },
    expectedVersion: command.expectedVersion ?? state.version ?? 0
  };
}

function singleRuleState(
  command: NotificationRuleRemoteCommand,
  state: NotificationRuleStateResponse
): NotificationRuleStateResponse {
  const ruleName = requiredRuleName(command);
  const entry = (state.rules ?? []).find((item) => item.rule.name === ruleName);
  if (entry === undefined) {
    throw new NotificationRuleRemoteError(`Notification rule '${ruleName}' was not found in remote state`);
  }
  return {
    ...state,
    rules: [entry]
  };
}

function mutationBody(command: NotificationRuleRemoteCommand): Record<string, unknown> {
  return {
    ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion })
  };
}

function formatNotificationRules(
  baseUrl: string,
  state: NotificationRuleStateResponse,
  title = "Notification rules"
): string {
  const rules = state.rules ?? [];
  return [
    `${title} at ${baseUrl}`,
    `DocType: ${state.doctypeName ?? "(unknown)"} Tenant: ${state.tenantId ?? "(unknown)"} Version: ${String(state.version ?? 0)} Total: ${String(rules.length)}`,
    ...ruleLines(rules),
    ""
  ].join("\n");
}

function ruleLines(rules: readonly NotificationRuleEntryResponse[]): readonly string[] {
  if (rules.length === 0) {
    return ["- (none)"];
  }
  return rules.flatMap((entry) => [ruleLine(entry), JSON.stringify(entry.rule)]);
}

function ruleLine(entry: NotificationRuleEntryResponse): string {
  const rule = entry.rule;
  const events = rule.events === undefined || rule.events.length === 0 ? "(none)" : rule.events.join(", ");
  const channels = rule.channels === undefined || rule.channels.length === 0 ? "inbox" : rule.channels.join(", ");
  const recipients = rule.recipients === undefined || rule.recipients.length === 0
    ? "(none)"
    : rule.recipients.map(recipientLabel).join(", ");
  const subject = rule.subject === undefined ? "" : ` subject "${rule.subject}"`;
  return `- ${rule.name} ${entry.enabled ?? rule.enabled ?? true ? "enabled" : "disabled"} channels ${channels} events ${events} recipients ${recipients}${subject}`;
}

function recipientLabel(recipient: NotificationRuleRecipientOption): string {
  if (recipient.kind === "user") {
    return `user:${recipient.userId}`;
  }
  if (recipient.kind === "field") {
    return `field:${recipient.field}`;
  }
  return "documentOwner";
}

function requiredRuleName(command: NotificationRuleRemoteCommand): string {
  if (command.ruleName === undefined) {
    throw new NotificationRuleRemoteError(`Notification rule ${command.action} requires --rule`);
  }
  return command.ruleName;
}

function requiredEvents(command: NotificationRuleRemoteCommand): readonly string[] {
  if (command.events === undefined || command.events.length === 0) {
    throw new NotificationRuleRemoteError("Notification rule save requires at least one --event");
  }
  return command.events;
}

function requiredRecipients(command: NotificationRuleRemoteCommand): readonly NotificationRuleRecipientOption[] {
  if (command.recipients === undefined || command.recipients.length === 0) {
    throw new NotificationRuleRemoteError(
      "Notification rule save requires at least one --recipient-user, --recipient-field, or --recipient-owner"
    );
  }
  return command.recipients;
}

function requiredResponseEvents(rule: NotificationRuleResponse, ruleName: string): readonly string[] {
  if (rule.events === undefined || rule.events.length === 0) {
    throw new NotificationRuleRemoteError(`Notification rule '${ruleName}' cannot be toggled because it has no events`);
  }
  return rule.events;
}

function requiredResponseRecipients(
  rule: NotificationRuleResponse,
  ruleName: string
): readonly NotificationRuleRecipientOption[] {
  if (rule.recipients === undefined || rule.recipients.length === 0) {
    throw new NotificationRuleRemoteError(`Notification rule '${ruleName}' cannot be toggled because it has no recipients`);
  }
  return rule.recipients;
}
