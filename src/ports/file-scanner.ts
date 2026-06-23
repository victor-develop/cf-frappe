export type FileScanSource = "buffered_upload" | "direct_upload" | "multipart_upload";
export type FileScanStatus = "clean" | "infected";

export interface FileScanTarget {
  readonly actorId: string;
  readonly tenantId: string;
  readonly key: string;
  readonly filename: string;
  readonly contentType: string;
  readonly size: number;
  readonly source: FileScanSource;
  readonly etag?: string;
  readonly httpEtag?: string;
}

export interface FileScanResult {
  readonly status: FileScanStatus;
  readonly engine?: string;
  readonly message?: string;
  readonly checkedAt?: string;
}

export interface FileScanner {
  scan(target: FileScanTarget): Promise<FileScanResult>;
}
