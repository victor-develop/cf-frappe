export function parseCookies(header: string | null): ReadonlyMap<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) {
      continue;
    }
    cookies.set(rawName, rawValue.join("="));
  }
  return cookies;
}
