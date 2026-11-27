import type { ScimTokenRecord, ScimTokenStore } from "../../ports/scim-token-store.js";
import { D1_SCIM_TOKENS_TABLE } from "./tables.js";

interface ScimTokenRow {
  readonly tenant_id: string;
  readonly token_id: string;
  readonly token_hash: string;
  readonly name: string;
  readonly created_at: string;
  readonly expires_at: string | null;
  readonly revoked_at: string | null;
  readonly last_used_at: string | null;
}

export class D1ScimTokenStore implements ScimTokenStore {
  constructor(private readonly db: D1Database) {}

  async put(record: ScimTokenRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO ${D1_SCIM_TOKENS_TABLE}
         (tenant_id, token_id, token_hash, name, created_at, expires_at, revoked_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(token_id) DO UPDATE SET
           token_hash = excluded.token_hash,
           name = excluded.name,
           expires_at = excluded.expires_at,
           revoked_at = excluded.revoked_at,
           last_used_at = excluded.last_used_at`
      )
      .bind(
        record.tenantId,
        record.tokenId,
        record.tokenHash,
        record.name,
        record.createdAt,
        record.expiresAt ?? null,
        record.revokedAt ?? null,
        record.lastUsedAt ?? null
      )
      .run();
  }

  async get(tokenId: string): Promise<ScimTokenRecord | undefined> {
    const row = await this.db
      .prepare(
        `SELECT tenant_id, token_id, token_hash, name, created_at, expires_at, revoked_at, last_used_at
         FROM ${D1_SCIM_TOKENS_TABLE}
         WHERE token_id = ?`
      )
      .bind(tokenId)
      .first<ScimTokenRow>();
    return row === null || row === undefined ? undefined : recordFromRow(row);
  }

  async list(tenantId: string): Promise<readonly ScimTokenRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT tenant_id, token_id, token_hash, name, created_at, expires_at, revoked_at, last_used_at
         FROM ${D1_SCIM_TOKENS_TABLE}
         WHERE tenant_id = ?
         ORDER BY created_at ASC, token_id ASC`
      )
      .bind(tenantId)
      .all<ScimTokenRow>();
    return (result.results ?? []).map(recordFromRow);
  }

  async revoke(options: {
    readonly tenantId: string;
    readonly tokenId: string;
    readonly revokedAt: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `UPDATE ${D1_SCIM_TOKENS_TABLE}
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE tenant_id = ? AND token_id = ?`
      )
      .bind(options.revokedAt, options.tenantId, options.tokenId)
      .run();
  }

  async touchLastUsed(options: {
    readonly tenantId: string;
    readonly tokenId: string;
    readonly usedAt: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `UPDATE ${D1_SCIM_TOKENS_TABLE}
         SET last_used_at = ?
         WHERE tenant_id = ? AND token_id = ? AND revoked_at IS NULL`
      )
      .bind(options.usedAt, options.tenantId, options.tokenId)
      .run();
  }
}

function recordFromRow(row: ScimTokenRow): ScimTokenRecord {
  return {
    tenantId: row.tenant_id,
    tokenId: row.token_id,
    tokenHash: row.token_hash,
    name: row.name,
    createdAt: row.created_at,
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
    ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
    ...(row.last_used_at === null ? {} : { lastUsedAt: row.last_used_at })
  };
}
