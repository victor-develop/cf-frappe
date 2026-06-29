import { printSettingsChangedPayload } from "../../src";
import type { PrintSettingsEventPayload } from "../../src";

describe("print settings events", () => {
  it("builds print settings change payloads", () => {
    expect(printSettingsPayload(printSettingsChangedPayload({
      settings: {
        defaultLayout: {
          pageSize: "A4",
          orientation: "landscape"
        }
      }
    }))).toEqual({
      kind: "PrintSettingsChanged",
      settings: {
        defaultLayout: {
          pageSize: "A4",
          orientation: "landscape"
        }
      }
    });
  });
});

function printSettingsPayload(payload: PrintSettingsEventPayload): PrintSettingsEventPayload {
  return payload;
}
