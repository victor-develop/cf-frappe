declare module "node:sqlite" {
  export interface StatementSync {
    all(...params: readonly (string | number | bigint | null)[]): readonly Record<string, unknown>[];
    run(...params: readonly (string | number | bigint | null)[]): { readonly changes: number };
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
