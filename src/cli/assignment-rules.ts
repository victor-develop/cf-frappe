import { requestRemoteAdmin, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type AssignmentRuleRemoteAction = "clear" | "disable" | "enable" | "get" | "list" | "save";

export type AssignmentRuleHeaderOption = RemoteHeaderOption;

export type AssignmentRuleAssigneeOption =
  | {
      readonly kind: "field";
      readonly field: string;
    }
  | {
      readonly kind: "user";
      readonly userId: string;
    };

export interface AssignmentRuleRemoteCommand {
  readonly kind: "assignment-rules";
  readonly action: AssignmentRuleRemoteAction;
  readonly url: string;
  readonly headers: readonly AssignmentRuleHeaderOption[];
  readonly doctype: string;
  readonly tenant?: string;
  readonly ruleName?: string;
  readonly events?: readonly string[];
  readonly assignees?: readonly AssignmentRuleAssigneeOption[];
  readonly condition?: Record<string, unknown>;
  readonly enabled?: boolean;
  readonly excludeActor?: boolean;
  readonly expectedVersion?: number;
}

export type AssignmentRuleRemoteIo = RemoteAdminIo;

export class AssignmentRuleRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssignmentRuleRemoteError";
  }
}

interface AssignmentRuleStateResponse {
  readonly tenantId?: string;
  readonly doctypeName?: string;
  readonly version?: number;
  readonly rules?: readonly AssignmentRuleEntryResponse[];
}

interface AssignmentRuleEntryResponse {
  readonly enabled?: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly rule: AssignmentRuleResponse;
}

interface AssignmentRuleResponse {
  readonly name: string;
  readonly enabled?: boolean;
  readonly events?: readonly string[];
  readonly assignees?: readonly AssignmentRuleAssigneeOption[];
  readonly condition?: Record<string, unknown>;
  readonly excludeActor?: boolean;
}

export async function runRemoteAssignmentRuleCommand(
  command: AssignmentRuleRemoteCommand,
  io: AssignmentRuleRemoteIo = {}
): Promise<string> {
  const query = tenantQuery(command);
  if (command.action === "list") {
    const data = await requestRemoteAssignmentRule(command, io, {
      method: "GET",
      path: assignmentRulesPath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatAssignmentRules(command.url, data);
  }
  if (command.action === "get") {
    const data = await requestRemoteAssignmentRule(command, io, {
      method: "GET",
      path: assignmentRulePath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatAssignmentRules(command.url, data, "Assignment rule");
  }
  if (command.action === "clear") {
    const data = await requestRemoteAssignmentRule(command, io, {
      body: mutationBody(command),
      method: "DELETE",
      path: assignmentRulePath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatAssignmentRules(command.url, data, "Cleared assignment rule");
  }
  if (command.action === "enable" || command.action === "disable") {
    const current = await requestRemoteAssignmentRule(command, io, {
      method: "GET",
      path: assignmentRulesPath(command),
      ...(query === undefined ? {} : { query })
    });
    const data = await requestRemoteAssignmentRule(command, io, {
      body: toggleBody(command, current, command.action === "enable"),
      method: "PUT",
      path: assignmentRulePath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatAssignmentRules(
      command.url,
      data,
      command.action === "enable" ? "Enabled assignment rule" : "Disabled assignment rule"
    );
  }
  const data = await requestRemoteAssignmentRule(command, io, {
    body: saveBody(command),
    method: "PUT",
    path: assignmentRulePath(command),
    ...(query === undefined ? {} : { query })
  });
  return formatAssignmentRules(command.url, data, "Saved assignment rule");
}

function requestRemoteAssignmentRule(
  command: AssignmentRuleRemoteCommand,
  io: AssignmentRuleRemoteIo,
  request: {
    readonly body?: Record<string, unknown>;
    readonly method: "DELETE" | "GET" | "PUT";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<AssignmentRuleStateResponse> {
  return requestRemoteAdmin<AssignmentRuleStateResponse, AssignmentRuleRemoteError>(command, io, request, {
    error: AssignmentRuleRemoteError,
    fetchLabel: "remote assignment-rule commands",
    resourceLabel: "Remote assignment rules",
    urlLabel: "Remote assignment rules"
  });
}

function assignmentRulesPath(command: AssignmentRuleRemoteCommand): string {
  return `/api/assignment-rules/${encodeURIComponent(command.doctype)}`;
}

function assignmentRulePath(command: AssignmentRuleRemoteCommand): string {
  return `${assignmentRulesPath(command)}/${encodeURIComponent(requiredRuleName(command))}`;
}

function tenantQuery(command: AssignmentRuleRemoteCommand): URLSearchParams | undefined {
  if (command.tenant === undefined) {
    return undefined;
  }
  const params = new URLSearchParams();
  params.set("tenant", command.tenant);
  return params;
}

function saveBody(command: AssignmentRuleRemoteCommand): Record<string, unknown> {
  return {
    rule: {
      events: [...requiredEvents(command)],
      assignees: [...requiredAssignees(command)],
      ...(command.condition === undefined ? {} : { condition: command.condition }),
      ...(command.enabled === undefined ? {} : { enabled: command.enabled }),
      ...(command.excludeActor === undefined ? {} : { excludeActor: command.excludeActor })
    },
    ...mutationBody(command)
  };
}

function toggleBody(
  command: AssignmentRuleRemoteCommand,
  state: AssignmentRuleStateResponse,
  enabled: boolean
): Record<string, unknown> {
  const ruleName = requiredRuleName(command);
  if (
    command.expectedVersion !== undefined &&
    state.version !== undefined &&
    state.version !== command.expectedVersion
  ) {
    throw new AssignmentRuleRemoteError(
      `Expected assignment rules at version ${String(command.expectedVersion)}, found ${String(state.version)}`
    );
  }
  const entry = (state.rules ?? []).find((item) => item.rule.name === ruleName);
  if (entry === undefined) {
    throw new AssignmentRuleRemoteError(`Assignment rule '${ruleName}' was not found in remote state`);
  }
  return {
    rule: {
      events: [...requiredResponseEvents(entry.rule, ruleName)],
      assignees: [...requiredResponseAssignees(entry.rule, ruleName)],
      ...(entry.rule.condition === undefined ? {} : { condition: entry.rule.condition }),
      enabled,
      ...(entry.rule.excludeActor === undefined ? {} : { excludeActor: entry.rule.excludeActor })
    },
    expectedVersion: command.expectedVersion ?? state.version ?? 0
  };
}

function mutationBody(command: AssignmentRuleRemoteCommand): Record<string, unknown> {
  return {
    ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion })
  };
}

function formatAssignmentRules(
  baseUrl: string,
  state: AssignmentRuleStateResponse,
  title = "Assignment rules"
): string {
  const rules = state.rules ?? [];
  return [
    `${title} at ${baseUrl}`,
    `DocType: ${state.doctypeName ?? "(unknown)"} Tenant: ${state.tenantId ?? "(unknown)"} Version: ${String(state.version ?? 0)} Total: ${String(rules.length)}`,
    ...ruleLines(rules),
    ""
  ].join("\n");
}

function ruleLines(rules: readonly AssignmentRuleEntryResponse[]): readonly string[] {
  if (rules.length === 0) {
    return ["- (none)"];
  }
  return rules.flatMap((entry) => [ruleLine(entry), JSON.stringify(entry.rule)]);
}

function ruleLine(entry: AssignmentRuleEntryResponse): string {
  const rule = entry.rule;
  const events = rule.events === undefined || rule.events.length === 0 ? "(none)" : rule.events.join(", ");
  const assignees = rule.assignees === undefined || rule.assignees.length === 0
    ? "(none)"
    : rule.assignees.map(assigneeLabel).join(", ");
  return `- ${rule.name} ${entry.enabled ?? rule.enabled ?? true ? "enabled" : "disabled"} events ${events} assignees ${assignees}`;
}

function assigneeLabel(assignee: AssignmentRuleAssigneeOption): string {
  return assignee.kind === "user" ? `user:${assignee.userId}` : `field:${assignee.field}`;
}

function requiredRuleName(command: AssignmentRuleRemoteCommand): string {
  if (command.ruleName === undefined) {
    throw new AssignmentRuleRemoteError(`Assignment rule ${command.action} requires --rule`);
  }
  return command.ruleName;
}

function requiredEvents(command: AssignmentRuleRemoteCommand): readonly string[] {
  if (command.events === undefined || command.events.length === 0) {
    throw new AssignmentRuleRemoteError("Assignment rule save requires at least one --event");
  }
  return command.events;
}

function requiredAssignees(command: AssignmentRuleRemoteCommand): readonly AssignmentRuleAssigneeOption[] {
  if (command.assignees === undefined || command.assignees.length === 0) {
    throw new AssignmentRuleRemoteError(
      "Assignment rule save requires at least one --assignee-user or --assignee-field"
    );
  }
  return command.assignees;
}

function requiredResponseEvents(rule: AssignmentRuleResponse, ruleName: string): readonly string[] {
  if (rule.events === undefined || rule.events.length === 0) {
    throw new AssignmentRuleRemoteError(`Assignment rule '${ruleName}' cannot be toggled because it has no events`);
  }
  return rule.events;
}

function requiredResponseAssignees(
  rule: AssignmentRuleResponse,
  ruleName: string
): readonly AssignmentRuleAssigneeOption[] {
  if (rule.assignees === undefined || rule.assignees.length === 0) {
    throw new AssignmentRuleRemoteError(`Assignment rule '${ruleName}' cannot be toggled because it has no assignees`);
  }
  return rule.assignees;
}
