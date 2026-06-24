import type { Context } from "hono";
import type { ReportCsvExport } from "../../application/report-service.js";

export interface CsvExportResponse {
  readonly filename: string;
  readonly contentType: string;
  readonly exported: number;
  readonly total: number;
  readonly limit: number;
  readonly truncated: boolean;
}

export function writeCsvExportHeaders(c: Context, csv: CsvExportResponse): void {
  c.header("content-type", csv.contentType);
  c.header("content-disposition", `attachment; filename="${csv.filename.replace(/["\\]/g, "_")}"`);
  c.header("x-cf-frappe-export-total", String(csv.total));
  c.header("x-cf-frappe-exported", String(csv.exported));
  c.header("x-cf-frappe-export-limit", String(csv.limit));
  c.header("x-cf-frappe-export-truncated", String(csv.truncated));
}

export function writeReportCsvHeaders(c: Context, csv: ReportCsvExport): void {
  writeCsvExportHeaders(c, csv);
}
