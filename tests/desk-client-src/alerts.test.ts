import { msgprint, throwMessage } from "../../src/adapters/desk/client-src/alerts";

describe("client-src alerts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("msgprint surfaces the message through window.alert and returns the text", () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    expect(msgprint("saved")).toBe("saved");
    expect(alertSpy).toHaveBeenCalledWith("saved");
  });

  it("msgprint stringifies non-string messages and maps nullish to empty string", () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    expect(msgprint(42)).toBe("42");
    expect(msgprint(null)).toBe("");
    expect(msgprint(undefined)).toBe("");
    expect(alertSpy).toHaveBeenNthCalledWith(2, "");
  });

  it("msgprint still returns the text when window.alert is unavailable", () => {
    vi.stubGlobal("alert", undefined);
    expect(msgprint("quiet")).toBe("quiet");
  });

  it("throwMessage alerts then throws an Error carrying the text", () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    expect(() => throwMessage("boom")).toThrowError("boom");
    expect(alertSpy).toHaveBeenCalledWith("boom");
  });
});
