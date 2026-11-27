import type { ScimTokenRecord, ScimTokenStore } from "../../ports/scim-token-store.js";

export class InMemoryScimTokenStore implements ScimTokenStore {
  private readonly records = new Map<string, ScimTokenRecord>();

  async put(record: ScimTokenRecord): Promise<void> {
    this.records.set(record.tokenId, { ...record });
  }

  async get(tokenId: string): Promise<ScimTokenRecord | undefined> {
    const record = this.records.get(tokenId);
    return record === undefined ? undefined : { ...record };
  }

  async list(tenantId: string): Promise<readonly ScimTokenRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.tenantId === tenantId)
      .map((record) => ({ ...record }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.tokenId.localeCompare(right.tokenId));
  }

  async revoke(options: {
    readonly tenantId: string;
    readonly tokenId: string;
    readonly revokedAt: string;
  }): Promise<void> {
    const record = this.records.get(options.tokenId);
    if (record === undefined || record.tenantId !== options.tenantId) {
      return;
    }
    this.records.set(options.tokenId, {
      ...record,
      revokedAt: record.revokedAt ?? options.revokedAt
    });
  }

  async touchLastUsed(options: {
    readonly tenantId: string;
    readonly tokenId: string;
    readonly usedAt: string;
  }): Promise<void> {
    const record = this.records.get(options.tokenId);
    if (record === undefined || record.tenantId !== options.tenantId) {
      return;
    }
    this.records.set(options.tokenId, { ...record, lastUsedAt: options.usedAt });
  }
}
