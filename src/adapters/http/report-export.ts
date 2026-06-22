import type { Context } from "hono";
import type { ReportCsvExport } from "../../application/report-service";

export function writeReportCsvHeaders(c: Context, csv: ReportCsvExport): void {
  c.header("content-type", csv.contentType);
  c.header("content-disposition", `attachment; filename="${csv.filename.replace(/["\\]/g, "_")}"`);
  c.header("x-cf-frappe-export-total", String(csv.total));
  c.header("x-cf-frappe-exported", String(csv.exported));
  c.header("x-cf-frappe-export-limit", String(csv.limit));
  c.header("x-cf-frappe-export-truncated", String(csv.truncated));
}
