/**
 * Boot sequence + hydrator/namespace registries.
 *
 * Behavior modules (uploads, filter builder, formula builder, form binding, realtime,
 * presence, ...) self-register at import time via `registerHydrator` /
 * `registerNamespaceContribution`. `hydrators.ts` (the generated import list) pulls those
 * modules in before `main.ts` calls `boot()`, so this file never needs edits when new
 * behavior modules land.
 */

import { pageContext, ready } from "./context.js";
import { coreSeam, installNamespace } from "./namespace.js";
import type {
  HydratorRegistration,
  HydratorRegistry,
  NamespaceContribution,
  NamespaceExtensions
} from "./seams.js";

const registrations: HydratorRegistration[] = [];
const contributions: NamespaceContribution[] = [];

export const hydratorRegistry: HydratorRegistry = {
  register(registration: HydratorRegistration): void {
    registrations.push(registration);
  },
  list(): readonly HydratorRegistration[] {
    return registrations.slice();
  }
};

export function registerHydrator(registration: HydratorRegistration): void {
  hydratorRegistry.register(registration);
}

export function registerNamespaceContribution(contribution: NamespaceContribution): void {
  contributions.push(contribution);
}

export function collectNamespaceExtensions(): NamespaceExtensions {
  const collected: NamespaceExtensions = {};
  for (const contribution of contributions) {
    const extensions = contribution(coreSeam);
    if (extensions.files !== undefined) {
      collected.files = Object.assign({}, collected.files ?? {}, extensions.files);
    }
    if (extensions.form !== undefined) {
      collected.form = extensions.form;
    }
    if (extensions.realtime !== undefined) {
      collected.realtime = extensions.realtime;
    }
    if (extensions.collaboration !== undefined) {
      collected.collaboration = extensions.collaboration;
    }
  }
  return collected;
}

/** Test seam: clears both registries (registration order is import order in production). */
export function resetRegistries(): void {
  registrations.length = 0;
  contributions.length = 0;
}

export function boot(): void {
  installNamespace(collectNamespaceExtensions());
  for (const registration of hydratorRegistry.list()) {
    ready(registration.hydrate);
  }
}

export { pageContext, ready };
