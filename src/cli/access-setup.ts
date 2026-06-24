export type CloudflareAccessSetupAction = "plan" | "apply";

export type CloudflareAccessSetupScope =
  | { readonly kind: "account"; readonly id: string }
  | { readonly kind: "zone"; readonly id: string };

export type CloudflareAccessPolicyInclude =
  | { readonly kind: "email"; readonly email: string }
  | { readonly kind: "email-domain"; readonly domain: string }
  | { readonly kind: "group"; readonly id: string }
  | { readonly kind: "everyone" };

export interface CloudflareAccessSetupCommand {
  readonly kind: "access-setup";
  readonly action: CloudflareAccessSetupAction;
  readonly scope: CloudflareAccessSetupScope;
  readonly name: string;
  readonly domain: string;
  readonly teamDomain: string;
  readonly policyName: string;
  readonly includes: readonly CloudflareAccessPolicyInclude[];
  readonly allowedIdps?: readonly string[];
  readonly sessionDuration?: string;
  readonly apiTokenEnv?: string;
  readonly apiBaseUrl?: string;
}

export interface CloudflareAccessSetupIo {
  readonly env?: (name: string) => string | undefined;
  readonly fetch?: typeof fetch;
}

export interface CloudflareAccessSetupPlan {
  readonly scope: CloudflareAccessSetupScope;
  readonly application: CloudflareAccessApplicationCreateBody;
  readonly policy: CloudflareAccessApplicationPolicyCreateBody;
  readonly applicationPath: string;
  readonly policyPath: string;
  readonly vars: {
    readonly CF_ACCESS_TEAM_DOMAIN: string;
    readonly CF_ACCESS_AUD: string;
  };
}

interface CloudflareAccessApplicationCreateBody {
  readonly name: string;
  readonly domain: string;
  readonly type: "self_hosted";
  readonly session_duration?: string;
  readonly app_launcher_visible: boolean;
  readonly allowed_idps?: readonly string[];
}

interface CloudflareAccessApplicationPolicyCreateBody {
  readonly name: string;
  readonly decision: "allow";
  readonly include: readonly Record<string, Record<string, string>>[];
}

interface CloudflareApiEnvelope {
  readonly success?: boolean;
  readonly errors?: readonly unknown[];
  readonly messages?: readonly unknown[];
  readonly result?: unknown;
}

export class CloudflareAccessSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudflareAccessSetupError";
  }
}

export async function runCloudflareAccessSetupCommand(
  command: CloudflareAccessSetupCommand,
  io: CloudflareAccessSetupIo = {}
): Promise<string> {
  const plan = cloudflareAccessSetupPlan(command);
  if (command.action === "plan") {
    return formatCloudflareAccessPlan(plan);
  }

  const runFetch = io.fetch ?? globalThis.fetch;
  if (typeof runFetch !== "function") {
    throw new CloudflareAccessSetupError("No fetch implementation is available for Cloudflare Access setup");
  }
  const token = accessApiToken(command, io.env);
  const apiBaseUrl = normalizeApiBaseUrl(command.apiBaseUrl ?? "https://api.cloudflare.com/client/v4");
  const app = await cloudflareApiPost(runFetch, apiBaseUrl, plan.applicationPath, token, plan.application);
  const appId = stringResultField(app, "id", "created Access application id");
  const audience = accessAudience(app);
  const policy = await cloudflareApiPost(
    runFetch,
    apiBaseUrl,
    accessPolicyPath(command.scope, appId),
    token,
    plan.policy
  );
  const policyId = optionalStringField(policy, "id");
  return formatCloudflareAccessApply(plan, {
    applicationId: appId,
    audience,
    ...(policyId === undefined ? {} : { policyId })
  });
}

export function cloudflareAccessSetupPlan(command: CloudflareAccessSetupCommand): CloudflareAccessSetupPlan {
  const application: CloudflareAccessApplicationCreateBody = {
    name: command.name,
    domain: command.domain,
    type: "self_hosted",
    app_launcher_visible: false,
    ...(command.sessionDuration === undefined ? {} : { session_duration: command.sessionDuration }),
    ...(command.allowedIdps === undefined || command.allowedIdps.length === 0
      ? {}
      : { allowed_idps: [...command.allowedIdps] })
  };
  const policy: CloudflareAccessApplicationPolicyCreateBody = {
    name: command.policyName,
    decision: "allow",
    include: command.includes.map(accessPolicyInclude)
  };
  return {
    scope: command.scope,
    application,
    policy,
    applicationPath: accessApplicationPath(command.scope),
    policyPath: `${accessApplicationPath(command.scope)}/<created-access-application-id>/policies`,
    vars: {
      CF_ACCESS_TEAM_DOMAIN: command.teamDomain,
      CF_ACCESS_AUD: "<created-access-application-aud>"
    }
  };
}

function accessApplicationPath(scope: CloudflareAccessSetupScope): string {
  return scope.kind === "account"
    ? `/accounts/${encodeURIComponent(scope.id)}/access/apps`
    : `/zones/${encodeURIComponent(scope.id)}/access/apps`;
}

function accessPolicyPath(scope: CloudflareAccessSetupScope, appId: string): string {
  return `${accessApplicationPath(scope)}/${encodeURIComponent(appId)}/policies`;
}

function accessPolicyInclude(include: CloudflareAccessPolicyInclude): Record<string, Record<string, string>> {
  if (include.kind === "email") {
    return { email: { email: include.email } };
  }
  if (include.kind === "email-domain") {
    return { email_domain: { domain: include.domain } };
  }
  if (include.kind === "group") {
    return { group: { id: include.id } };
  }
  return { everyone: {} };
}

async function cloudflareApiPost(
  runFetch: typeof fetch,
  apiBaseUrl: string,
  path: string,
  token: string,
  body: unknown
): Promise<Record<string, unknown>> {
  const response = await runFetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await readCloudflareJson(response);
  if (!response.ok || payload.success === false) {
    throw new CloudflareAccessSetupError(
      `Cloudflare Access setup request failed (${response.status}): ${cloudflareErrorMessage(payload)}`
    );
  }
  if (!isRecord(payload.result)) {
    throw new CloudflareAccessSetupError("Cloudflare Access setup response did not include a result object");
  }
  return payload.result;
}

async function readCloudflareJson(response: Response): Promise<CloudflareApiEnvelope> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return {};
  }
  try {
    const payload = JSON.parse(text) as unknown;
    return isRecord(payload) ? payload : {};
  } catch {
    throw new CloudflareAccessSetupError(`Cloudflare Access setup response was not valid JSON (${response.status})`);
  }
}

function cloudflareErrorMessage(payload: CloudflareApiEnvelope): string {
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  const messages = errors
    .map((error) => {
      if (!isRecord(error)) {
        return undefined;
      }
      const code = typeof error.code === "number" || typeof error.code === "string" ? String(error.code) : "ERROR";
      const message = typeof error.message === "string" ? error.message : undefined;
      return message === undefined ? code : `${code}: ${message}`;
    })
    .filter((message): message is string => message !== undefined);
  return messages.length === 0 ? "Cloudflare API returned an error" : messages.join("; ");
}

function accessApiToken(
  command: CloudflareAccessSetupCommand,
  readEnv: ((name: string) => string | undefined) | undefined
): string {
  if (command.apiTokenEnv === undefined) {
    throw new CloudflareAccessSetupError("Cloudflare Access apply requires --api-token-env");
  }
  const value = readEnv?.(command.apiTokenEnv);
  if (value === undefined || value === "") {
    throw new CloudflareAccessSetupError(`Environment variable '${command.apiTokenEnv}' is not set for Cloudflare API token`);
  }
  return value;
}

function accessAudience(result: Record<string, unknown>): string {
  const direct = optionalStringField(result, "aud") ?? optionalStringField(result, "audience_tag");
  if (direct !== undefined) {
    return direct;
  }
  const audiences = result.audiences;
  if (Array.isArray(audiences) && typeof audiences[0] === "string") {
    return audiences[0];
  }
  throw new CloudflareAccessSetupError("Cloudflare Access application response did not include an audience tag");
}

function stringResultField(result: Record<string, unknown>, field: string, label: string): string {
  const value = optionalStringField(result, field);
  if (value === undefined) {
    throw new CloudflareAccessSetupError(`Cloudflare Access application response did not include ${label}`);
  }
  return value;
}

function optionalStringField(result: Record<string, unknown>, field: string): string | undefined {
  const value = result[field];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizeApiBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CloudflareAccessSetupError(`Cloudflare API base URL '${value}' is not a valid absolute URL`);
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function formatCloudflareAccessPlan(plan: CloudflareAccessSetupPlan): string {
  return [
    "Cloudflare Access setup plan",
    `Scope: ${plan.scope.kind} ${plan.scope.id}`,
    `Create Access application: POST ${plan.applicationPath}`,
    JSON.stringify(plan.application, null, 2),
    `Create application policy: POST ${plan.policyPath}`,
    JSON.stringify(plan.policy, null, 2),
    "Wrangler vars after apply:",
    `  CF_ACCESS_TEAM_DOMAIN=${plan.vars.CF_ACCESS_TEAM_DOMAIN}`,
    `  CF_ACCESS_AUD=${plan.vars.CF_ACCESS_AUD}`,
    ""
  ].join("\n");
}

function formatCloudflareAccessApply(
  plan: CloudflareAccessSetupPlan,
  result: {
    readonly applicationId: string;
    readonly audience: string;
    readonly policyId?: string;
  }
): string {
  return [
    "Created Cloudflare Access resources",
    `Application: ${result.applicationId}`,
    `Policy: ${result.policyId ?? "(created)"}`,
    "Wrangler vars:",
    `  CF_ACCESS_TEAM_DOMAIN=${plan.vars.CF_ACCESS_TEAM_DOMAIN}`,
    `  CF_ACCESS_AUD=${result.audience}`,
    ""
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
