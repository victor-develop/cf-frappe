import { FrameworkError } from "./errors";

const appNamePattern = /^[a-z][a-z0-9_-]*$/;

export function assertAppName(name: string): void {
  if (!appNamePattern.test(name)) {
    throw new FrameworkError("APP_INVALID", `Invalid app name '${name}'`, { status: 400 });
  }
}

export function assertAppNames(names: readonly string[]): void {
  for (const name of names) {
    assertAppName(name);
  }
}
