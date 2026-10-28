import { describe, expect, it } from "vitest";
import {
  ARCHIVE_PROTECTED_STREAM_DOCTYPES,
  automationRunStream,
  documentDeliveryOutboxStream,
  documentStream,
  isArchivableStream,
  namingConfigurationStream,
  namingSeriesStream,
  parseStreamName,
  uniqueValueStream,
  userNotificationsStream
} from "../../src";

/**
 * Which streams the event archive may ever touch (issue #18). The protection is
 * a property of the stream name, checked by the adapter that deletes hot rows,
 * so no caller and no cut policy can archive a naming-series counter or a
 * unique-value claim.
 */
describe("archive-protected streams", () => {
  it("are derived from the naming-series and unique-value stream builders", () => {
    expect(ARCHIVE_PROTECTED_STREAM_DOCTYPES).toEqual(["__NamingSeries", "__UniqueValues"]);
  });

  it("refuses every naming-series and unique-value stream, whatever the tenant or value", () => {
    for (const tenant of ["acme", "default", "a:b", "weird.tenant", "__global__"]) {
      expect(isArchivableStream(namingSeriesStream(tenant, "Return Request", "RMA-.YYYY.-", "date=2026"))).toBe(false);
      expect(isArchivableStream(namingSeriesStream(tenant, "Note", "N"))).toBe(false);
      expect(isArchivableStream(uniqueValueStream(tenant, "Customer", "customer_id", "s:CUST:1"))).toBe(false);
    }
  });

  it("refuses names the framework does not build", () => {
    for (const stream of ["", "garbage", "a:b", "a:b:c:d", "acme:%E0%A4%A:x"]) {
      expect(isArchivableStream(stream), stream).toBe(false);
    }
  });

  it("allows documents and the unbounded framework streams", () => {
    expect(isArchivableStream(documentStream("acme", "Note", "One"))).toBe(true);
    expect(isArchivableStream(documentStream("acme", "Return Request", "RMA-2026-000001"))).toBe(true);
    expect(isArchivableStream(userNotificationsStream("acme", "a@b.c"))).toBe(true);
    expect(isArchivableStream(documentDeliveryOutboxStream("acme"))).toBe(true);
    expect(isArchivableStream(automationRunStream("acme", "evt:rule:action"))).toBe(true);
    expect(isArchivableStream(namingConfigurationStream("acme", "Note"))).toBe(true);
  });

  it("parses a stream name back into its parts", () => {
    expect(parseStreamName(documentStream("a:b.c", "Return Request", "x/y:z"))).toEqual({
      tenantId: "a:b.c",
      doctype: "Return Request",
      name: "x/y:z"
    });
  });
});
