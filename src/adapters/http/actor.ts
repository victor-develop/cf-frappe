import { DEFAULT_TENANT_ID, type Actor } from "../../core/types.js";

export type ActorResolver = (request: Request) => Actor | Promise<Actor>;

export const unsafeHeaderActorResolver: ActorResolver = (request) => {
  const user = request.headers.get("x-cf-frappe-user") ?? "guest";
  const roles = parseCsv(request.headers.get("x-cf-frappe-roles") ?? "Guest");
  const tenantId = request.headers.get("x-cf-frappe-tenant") ?? DEFAULT_TENANT_ID;
  const email = request.headers.get("x-cf-frappe-email");
  return email ? { id: user, roles, tenantId, email } : { id: user, roles, tenantId };
};

function parseCsv(value: string): readonly string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
