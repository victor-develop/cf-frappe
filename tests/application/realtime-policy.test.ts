import { DEFAULT_DESK_REALTIME_ROUTE, resolveDeskRealtimeRoute } from "../../src";

describe("realtime policy", () => {
  it("keeps Desk realtime presentation disabled when no route config is enabled", () => {
    expect(resolveDeskRealtimeRoute(undefined)).toBeUndefined();
    expect(resolveDeskRealtimeRoute(false)).toBeUndefined();
  });

  it("resolves default and custom Desk realtime routes", () => {
    expect(resolveDeskRealtimeRoute(true)).toBe(DEFAULT_DESK_REALTIME_ROUTE);
    expect(resolveDeskRealtimeRoute({})).toBe(DEFAULT_DESK_REALTIME_ROUTE);
    expect(resolveDeskRealtimeRoute({ route: "/live/realtime" })).toBe("/live/realtime");
  });
});
