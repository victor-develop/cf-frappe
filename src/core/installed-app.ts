import { assertAppName, assertAppNames } from "./app-name.js";

export interface InstalledAppDefinition {
  readonly name: string;
  readonly label?: string;
  readonly version?: string;
  readonly modules: readonly string[];
  readonly dependencies: readonly string[];
}

export interface InstalledAppInput {
  readonly name: string;
  readonly label?: string;
  readonly version?: string;
  readonly modules?: readonly string[];
  readonly dependencies?: readonly string[];
}

export function defineInstalledApp(app: InstalledAppInput): InstalledAppDefinition {
  assertAppName(app.name);
  assertAppNames(app.dependencies ?? []);
  return Object.freeze({
    name: app.name,
    ...(app.label === undefined ? {} : { label: app.label }),
    ...(app.version === undefined ? {} : { version: app.version }),
    modules: Object.freeze([...(app.modules ?? [])]),
    dependencies: Object.freeze([...(app.dependencies ?? [])])
  });
}
