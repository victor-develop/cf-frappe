export interface ScimTokenRecord {
  readonly tenantId: string;
  readonly tokenId: string;
  readonly tokenHash: string;
  readonly name: string;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
  readonly lastUsedAt?: string;
}

export interface ScimTokenStore {
  put(record: ScimTokenRecord): Promise<void>;
  get(tokenId: string): Promise<ScimTokenRecord | undefined>;
  list(tenantId: string): Promise<readonly ScimTokenRecord[]>;
  revoke(options: {
    readonly tenantId: string;
    readonly tokenId: string;
    readonly revokedAt: string;
  }): Promise<void>;
  touchLastUsed(options: {
    readonly tenantId: string;
    readonly tokenId: string;
    readonly usedAt: string;
  }): Promise<void>;
}
