import { badRequest, conflict, notFound, permissionDenied } from "../core/errors.js";
import { DEFAULT_TENANT_ID, SYSTEM_MANAGER_ROLE, type Actor, type TenantId } from "../core/types.js";
import { systemClock, type Clock } from "../ports/clock.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";
import type { PasswordHasher } from "../ports/password-hasher.js";
import type { ScimTokenRecord, ScimTokenStore } from "../ports/scim-token-store.js";

export const MAX_SCIM_TOKEN_EXPIRY_SECONDS = 31_536_000;

export interface ScimTokenServiceOptions {
  readonly tokens: ScimTokenStore;
  readonly tokenSecrets: PasswordHasher;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
  readonly adminRoles?: readonly string[];
}

export interface IssueScimTokenCommand {
  readonly actor: Actor;
  readonly name: string;
  readonly tenantId?: TenantId;
  readonly expiresInSeconds?: number;
}

export interface ScimTokenIssueResult {
  readonly token: string;
  readonly record: ScimToken;
}

export interface ScimToken {
  readonly tenantId: TenantId;
  readonly tokenId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
  readonly lastUsedAt?: string;
}

export class ScimTokenService {
  private readonly tokens: ScimTokenStore;
  private readonly tokenSecrets: PasswordHasher;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly adminRoles: readonly string[];

  constructor(options: ScimTokenServiceOptions) {
    this.tokens = options.tokens;
    this.tokenSecrets = options.tokenSecrets;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.clock = options.clock ?? systemClock;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
  }

  async issue(command: IssueScimTokenCommand): Promise<ScimTokenIssueResult> {
    ensureScimTokenAdmin(command.actor, this.adminRoles);
    const tenantId = resolveScimTokenActorTenant(command.actor, command.tenantId);
    const name = normalizeRequiredScimText(command.name, "Token name");
    const tokenId = this.ids.next("scim_");
    const secret = this.ids.next("");
    const token = `${tokenId}_${secret}`;
    const tokenHash = await this.tokenSecrets.hash(secret);
    const createdAt = this.clock.now();
    const record: ScimTokenRecord = {
      tenantId,
      tokenId,
      tokenHash,
      name,
      createdAt,
      ...(command.expiresInSeconds === undefined
        ? {}
        : { expiresAt: scimTokenExpiresAt(createdAt, command.expiresInSeconds) })
    };
    await this.tokens.put(record);
    return { token, record: publicScimToken(record) };
  }

  async list(actor: Actor, tenantId?: TenantId): Promise<readonly ScimToken[]> {
    ensureScimTokenAdmin(actor, this.adminRoles);
    const resolvedTenantId = resolveScimTokenActorTenant(actor, tenantId);
    return (await this.tokens.list(resolvedTenantId)).map(publicScimToken);
  }

  async revoke(actor: Actor, tokenId: string, tenantId?: TenantId): Promise<ScimToken> {
    ensureScimTokenAdmin(actor, this.adminRoles);
    const resolvedTenantId = resolveScimTokenActorTenant(actor, tenantId);
    const id = normalizeRequiredScimText(tokenId, "Token id");
    const record = await this.tokens.get(id);
    if (record === undefined || record.tenantId !== resolvedTenantId) {
      throw notFound(`SCIM token '${id}' was not found`);
    }
    const revokedAt = this.clock.now();
    await this.tokens.revoke({ tenantId: resolvedTenantId, tokenId: id, revokedAt });
    return publicScimToken({ ...record, revokedAt: record.revokedAt ?? revokedAt });
  }

  async actorFromBearer(request: Request): Promise<Actor> {
    const token = scimBearerToken(request);
    const parts = parseScimToken(token);
    if (parts === undefined) {
      throw permissionDenied("SCIM bearer token is invalid");
    }
    const record = await this.tokens.get(parts.tokenId);
    if (record === undefined || !(await this.tokenSecrets.verify(parts.secret, record.tokenHash))) {
      throw permissionDenied("SCIM bearer token is invalid");
    }
    const now = this.clock.now();
    if (
      record.revokedAt !== undefined ||
      (record.expiresAt !== undefined && Date.parse(record.expiresAt) <= Date.parse(now))
    ) {
      throw permissionDenied("SCIM bearer token is no longer active");
    }
    await this.tokens.touchLastUsed({ tenantId: record.tenantId, tokenId: record.tokenId, usedAt: now });
    return {
      id: `scim:${record.tokenId}`,
      roles: [SYSTEM_MANAGER_ROLE],
      tenantId: record.tenantId
    };
  }
}

export function ensureScimTokenAdmin(actor: Actor, adminRoles: readonly string[]): void {
  if (!adminRoles.some((role) => actor.roles.includes(role))) {
    throw permissionDenied(`Actor '${actor.id}' cannot manage SCIM tokens`);
  }
}

export function resolveScimTokenActorTenant(actor: Actor, explicitTenantId: TenantId | undefined): TenantId {
  const actorTenantId = actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = explicitTenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${actor.id}' cannot manage SCIM tokens for tenant '${tenantId}'`);
  }
  return tenantId;
}

export function normalizeRequiredScimText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw badRequest(`${label} is required`);
  }
  return normalized;
}

export function scimBearerToken(request: Request): string {
  const header = request.headers.get("authorization");
  const match = /^Bearer\s+(.+)$/iu.exec(header ?? "");
  const token = match?.[1]?.trim();
  if (token === undefined || token.length === 0) {
    throw permissionDenied("SCIM bearer token is required");
  }
  return token;
}

export function scimTokenExpiresAt(createdAt: string, seconds: number): string {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SCIM_TOKEN_EXPIRY_SECONDS) {
    throw badRequest(`SCIM token expiry must be between 1 and ${MAX_SCIM_TOKEN_EXPIRY_SECONDS} seconds`);
  }
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) {
    throw conflict("SCIM clock returned an invalid timestamp");
  }
  return new Date(created + seconds * 1_000).toISOString();
}

export function publicScimToken(record: ScimTokenRecord): ScimToken {
  return {
    tenantId: record.tenantId,
    tokenId: record.tokenId,
    name: record.name,
    createdAt: record.createdAt,
    ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
    ...(record.revokedAt === undefined ? {} : { revokedAt: record.revokedAt }),
    ...(record.lastUsedAt === undefined ? {} : { lastUsedAt: record.lastUsedAt })
  };
}

function parseScimToken(token: string): { readonly tokenId: string; readonly secret: string } | undefined {
  const separator = token.lastIndexOf("_");
  if (separator < 1 || separator === token.length - 1) {
    return undefined;
  }
  const tokenId = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  return tokenId.length === 0 || secret.length === 0 ? undefined : { tokenId, secret };
}
