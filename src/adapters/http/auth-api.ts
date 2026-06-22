import { Hono } from "hono";
import type { UserAccountService } from "../../application/user-account-service.js";
import { badRequest } from "../../core/errors.js";
import type { Actor, JsonValue } from "../../core/types.js";
import type { ActorResolver } from "./actor.js";
import {
  clearSignedSessionCookie,
  createSignedSessionCookie,
  signedSessionActorResolver,
  type SignedSessionOptions
} from "./signed-session.js";
import { readJsonObject, requestMetadata } from "./request.js";

export interface AuthSessionOptions {
  readonly secret: string;
  readonly maxAgeSeconds: number;
  readonly cookieName?: string;
  readonly path?: string;
  readonly sameSite?: "Lax" | "Strict" | "None";
  readonly secure?: boolean;
  readonly now?: () => number;
}

export interface AuthApiOptions {
  readonly userAccounts: UserAccountService;
  readonly actor: ActorResolver;
  readonly session: AuthSessionOptions;
  readonly maxJsonBytes?: number;
}

export interface UserAccountSessionActorResolverOptions extends SignedSessionOptions {
  readonly userAccounts: UserAccountService;
  readonly fallback?: ActorResolver;
}

export function userAccountSessionActorResolver(options: UserAccountSessionActorResolverOptions): ActorResolver {
  return signedSessionActorResolver({
    secret: options.secret,
    ...(options.cookieName === undefined ? {} : { cookieName: options.cookieName }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.fallback === undefined ? {} : { fallback: options.fallback }),
    validate: (session) => options.userAccounts.resolveSessionActor(session.actor, session.accountVersion)
  });
}

export function createAuthApi(options: AuthApiOptions): Hono {
  const app = new Hono();
  const maxJsonBytes = options.maxJsonBytes ?? 1_048_576;

  app.post("/api/auth/login", async (c) => {
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const tenantId = optionalString(body.tenantId, "tenantId");
    const authenticated = await options.userAccounts.authenticateAccount({
      userId: loginUserId(body),
      password: requiredString(body.password, "password"),
      ...(tenantId === undefined ? {} : { tenantId })
    });
    c.header("Set-Cookie", await createSessionCookie(authenticated.actor, authenticated.account.version, options.session));
    return c.json({ data: authenticated.actor });
  });

  app.post("/api/auth/logout", (c) => {
    c.header("Set-Cookie", clearSessionCookie(options.session));
    return c.body(null, 204);
  });

  app.post("/api/auth/password-reset/request", async (c) => {
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const tenantId = optionalString(body.tenantId, "tenantId");
    await options.userAccounts.requestPasswordReset({
      userId: requiredString(body.userId, "userId"),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: { accepted: true } }, 202);
  });

  app.post("/api/auth/password-reset/complete", async (c) => {
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const tenantId = optionalString(body.tenantId, "tenantId");
    const data = await options.userAccounts.resetPassword({
      userId: requiredString(body.userId, "userId"),
      token: requiredString(body.token, "token"),
      password: requiredString(body.password, "password"),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.post("/api/auth/email-verification/request", async (c) => {
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const tenantId = optionalString(body.tenantId, "tenantId");
    await options.userAccounts.requestEmailVerification({
      userId: requiredString(body.userId, "userId"),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: { accepted: true } }, 202);
  });

  app.post("/api/auth/email-verification/complete", async (c) => {
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const tenantId = optionalString(body.tenantId, "tenantId");
    const data = await options.userAccounts.verifyEmail({
      userId: requiredString(body.userId, "userId"),
      token: requiredString(body.token, "token"),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.get("/api/auth/me", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: actor });
  });

  return app;
}

async function createSessionCookie(actor: Actor, accountVersion: number, options: AuthSessionOptions): Promise<string> {
  return createSignedSessionCookie(actor, {
    secret: options.secret,
    maxAgeSeconds: options.maxAgeSeconds,
    accountVersion,
    ...(options.cookieName === undefined ? {} : { cookieName: options.cookieName }),
    ...(options.path === undefined ? {} : { path: options.path }),
    ...(options.sameSite === undefined ? {} : { sameSite: options.sameSite }),
    ...(options.secure === undefined ? {} : { secure: options.secure }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
}

function clearSessionCookie(options: AuthSessionOptions): string {
  return clearSignedSessionCookie({
    ...(options.cookieName === undefined ? {} : { cookieName: options.cookieName }),
    ...(options.path === undefined ? {} : { path: options.path }),
    ...(options.sameSite === undefined ? {} : { sameSite: options.sameSite }),
    ...(options.secure === undefined ? {} : { secure: options.secure })
  });
}

function loginUserId(body: Record<string, JsonValue | undefined>): string {
  const userId = optionalString(body.userId, "userId");
  if (userId === undefined) {
    throw badRequest("userId is required");
  }
  return userId;
}

function requiredString(value: JsonValue | undefined, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`${field} is required`);
  }
  return value;
}

function optionalString(value: JsonValue | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`${field} must be a non-empty string`);
  }
  return value;
}
