import { requestRemoteAdmin, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type WorkflowRemoteAction = "clear" | "get" | "save";

export type WorkflowHeaderOption = RemoteHeaderOption;

export interface WorkflowRemoteCommand {
  readonly kind: "workflows";
  readonly action: WorkflowRemoteAction;
  readonly url: string;
  readonly headers: readonly WorkflowHeaderOption[];
  readonly doctype: string;
  readonly tenant?: string;
  readonly workflow?: Record<string, unknown>;
  readonly expectedVersion?: number;
}

export type WorkflowRemoteIo = RemoteAdminIo;

export class WorkflowRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowRemoteError";
  }
}

interface WorkflowStateResponse {
  readonly tenantId?: string;
  readonly doctypeName?: string;
  readonly version?: number;
  readonly workflow?: WorkflowResponse;
}

interface WorkflowResponse {
  readonly stateField?: string;
  readonly initialState?: string;
  readonly states?: readonly string[];
  readonly transitions?: readonly WorkflowTransitionResponse[];
}

interface WorkflowTransitionResponse {
  readonly action?: string;
  readonly from?: string;
  readonly to?: string;
  readonly roles?: readonly string[];
  readonly eventType?: string;
}

export async function runRemoteWorkflowCommand(
  command: WorkflowRemoteCommand,
  io: WorkflowRemoteIo = {}
): Promise<string> {
  const query = tenantQuery(command);
  if (command.action === "get") {
    const data = await requestRemoteWorkflow(command, io, {
      method: "GET",
      path: workflowPath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatWorkflow(command.url, data);
  }
  if (command.action === "clear") {
    const data = await requestRemoteWorkflow(command, io, {
      ...(command.expectedVersion === undefined ? {} : { body: mutationBody(command) }),
      method: "DELETE",
      path: workflowPath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatWorkflow(command.url, data, "Cleared workflow definition");
  }
  const data = await requestRemoteWorkflow(command, io, {
    body: saveBody(command),
    method: "PUT",
    path: workflowPath(command),
    ...(query === undefined ? {} : { query })
  });
  return formatWorkflow(command.url, data, "Saved workflow definition");
}

function requestRemoteWorkflow(
  command: WorkflowRemoteCommand,
  io: WorkflowRemoteIo,
  request: {
    readonly body?: Record<string, unknown>;
    readonly method: "DELETE" | "GET" | "PUT";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<WorkflowStateResponse> {
  return requestRemoteAdmin<WorkflowStateResponse, WorkflowRemoteError>(command, io, request, {
    error: WorkflowRemoteError,
    fetchLabel: "remote workflow commands",
    resourceLabel: "Remote workflows",
    urlLabel: "Remote workflows"
  });
}

function workflowPath(command: WorkflowRemoteCommand): string {
  return `/api/workflows/${encodeURIComponent(command.doctype)}`;
}

function tenantQuery(command: WorkflowRemoteCommand): URLSearchParams | undefined {
  if (command.tenant === undefined) {
    return undefined;
  }
  const params = new URLSearchParams();
  params.set("tenant", command.tenant);
  return params;
}

function saveBody(command: WorkflowRemoteCommand): Record<string, unknown> {
  return {
    workflow: requiredWorkflow(command),
    ...mutationBody(command)
  };
}

function mutationBody(command: WorkflowRemoteCommand): Record<string, unknown> {
  return {
    ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion })
  };
}

function formatWorkflow(
  baseUrl: string,
  state: WorkflowStateResponse,
  title = "Workflow definition"
): string {
  const workflow = state.workflow;
  return [
    `${title} at ${baseUrl}`,
    `DocType: ${state.doctypeName ?? "(unknown)"} Tenant: ${state.tenantId ?? "(unknown)"} Version: ${String(state.version ?? 0)}`,
    workflow === undefined ? "- (none)" : workflowLine(workflow),
    ...(workflow === undefined ? [] : [JSON.stringify(workflow)]),
    ""
  ].join("\n");
}

function workflowLine(workflow: WorkflowResponse): string {
  const stateField = workflow.stateField ?? "workflow_state";
  const states = workflow.states === undefined || workflow.states.length === 0 ? "(none)" : workflow.states.join(", ");
  const transitionCount = workflow.transitions?.length ?? 0;
  return `- state ${stateField} initial ${workflow.initialState ?? "(unknown)"} states ${states} transitions ${String(transitionCount)}`;
}

function requiredWorkflow(command: WorkflowRemoteCommand): Record<string, unknown> {
  if (command.workflow === undefined) {
    throw new WorkflowRemoteError("Workflow save requires --workflow-json");
  }
  return command.workflow;
}
