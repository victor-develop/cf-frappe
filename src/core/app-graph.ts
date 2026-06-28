import { assertAppName, assertAppNames } from "./app-name.js";
import { FrameworkError } from "./errors.js";

export interface AppDependencyNode {
  readonly name: string;
  readonly dependencies?: readonly string[];
}

export function resolveAppDependencyOrder<T extends AppDependencyNode>(apps: readonly T[]): readonly T[] {
  const byName = new Map<string, T>();
  for (const app of apps) {
    assertAppName(app.name);
    assertAppNames(app.dependencies ?? []);
    if (byName.has(app.name)) {
      throw new FrameworkError("APP_DUPLICATE", `App '${app.name}' is already registered`, { status: 409 });
    }
    byName.set(app.name, app);
  }

  const ordered: T[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  for (const app of apps) {
    visitApp(app, byName, visiting, visited, ordered);
  }
  return Object.freeze(ordered);
}

function visitApp<T extends AppDependencyNode>(
  app: T,
  byName: ReadonlyMap<string, T>,
  visiting: Set<string>,
  visited: Set<string>,
  ordered: T[]
): void {
  if (visited.has(app.name)) {
    return;
  }
  if (visiting.has(app.name)) {
    throw new FrameworkError("APP_DEPENDENCY_CYCLE", `App dependency cycle includes '${app.name}'`, { status: 409 });
  }
  visiting.add(app.name);
  for (const dependencyName of app.dependencies ?? []) {
    const dependency = byName.get(dependencyName);
    if (!dependency) {
      throw new FrameworkError(
        "APP_DEPENDENCY_MISSING",
        `App '${app.name}' depends on missing app '${dependencyName}'`,
        { status: 400 }
      );
    }
    visitApp(dependency, byName, visiting, visited, ordered);
  }
  visiting.delete(app.name);
  visited.add(app.name);
  ordered.push(app);
}
