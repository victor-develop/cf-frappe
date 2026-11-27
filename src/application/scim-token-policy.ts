import { publicScimToken } from "./scim-token-service.js";
import type { ScimTokenRecord } from "../ports/scim-token-store.js";

export type { ScimToken } from "./scim-token-service.js";

export function scimTokenFromRecord(record: ScimTokenRecord) {
  return publicScimToken(record);
}
