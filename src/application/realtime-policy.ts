export const DEFAULT_DESK_REALTIME_ROUTE = "/api/realtime";

export type DeskRealtimeRouteConfig = boolean | { readonly route?: string } | undefined;

export function resolveDeskRealtimeRoute(realtime: DeskRealtimeRouteConfig): string | undefined {
  if (!realtime) {
    return undefined;
  }
  return typeof realtime === "object" ? realtime.route ?? DEFAULT_DESK_REALTIME_ROUTE : DEFAULT_DESK_REALTIME_ROUTE;
}
