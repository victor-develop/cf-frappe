import { D1ScimTokenStore } from "../../src";
import { createTestD1, frameworkSchema } from "../d1-engine.js";
import type { ScimTokenRecord } from "../../src";

describe("D1ScimTokenStore", () => {
  it("persists scoped token lifecycle records without exposing plaintext secrets", async () => {
    const d1 = createTestD1({ schema: frameworkSchema() });
    const store = new D1ScimTokenStore(d1.database);
    await store.put(record("acme", "token-acme"));
    await store.put(record("other", "token-other"));

    await expect(store.get("token-acme")).resolves.toMatchObject({
      tenantId: "acme",
      tokenHash: "hash:secret",
      name: "Okta"
    });
    await expect(store.list("acme")).resolves.toHaveLength(1);
    await expect(store.list("acme")).resolves.toMatchObject([{ tenantId: "acme", tokenId: "token-acme" }]);

    await store.revoke({ tenantId: "acme", tokenId: "token-acme", revokedAt: "2026-01-02T00:00:00.000Z" });
    await expect(store.get("token-acme")).resolves.toMatchObject({
      revokedAt: "2026-01-02T00:00:00.000Z"
    });

    await store.touchLastUsed({ tenantId: "other", tokenId: "token-other", usedAt: "2026-01-03T00:00:00.000Z" });
    await expect(store.get("token-other")).resolves.toMatchObject({
      lastUsedAt: "2026-01-03T00:00:00.000Z"
    });
  });
});

function record(tenantId: string, tokenId: string): ScimTokenRecord {
  return {
    tenantId,
    tokenId,
    tokenHash: "hash:secret",
    name: "Okta",
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}
