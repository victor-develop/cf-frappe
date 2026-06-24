import { FrameworkError } from "./errors.js";
import { SYSTEM_MANAGER_ROLE, type Actor, type JsonPrimitive, type ListDocumentsFilter } from "./types.js";

export type DashboardReportFilters = Readonly<Record<string, JsonPrimitive | undefined>>;

export type DashboardCardSourceDefinition =
  | {
      readonly kind: "documentCount";
      readonly doctype: string;
      readonly filters?: readonly ListDocumentsFilter[];
    }
  | {
      readonly kind: "reportSummary";
      readonly report: string;
      readonly summary: string;
      readonly filters?: DashboardReportFilters;
    };

export interface DashboardCardDefinition {
  readonly name: string;
  readonly label?: string;
  readonly description?: string;
  readonly indicator?: string;
  readonly source: DashboardCardSourceDefinition;
}

export interface DashboardDefinition {
  readonly name: string;
  readonly label?: string;
  readonly module?: string;
  readonly description?: string;
  readonly roles?: readonly string[];
  readonly cards: readonly DashboardCardDefinition[];
}

export function defineDashboard(definition: DashboardDefinition): DashboardDefinition {
  assertDashboardDefinition(definition);
  return Object.freeze({
    ...definition,
    ...(definition.roles ? { roles: Object.freeze([...definition.roles]) } : {}),
    cards: Object.freeze(
      definition.cards.map((card) =>
        Object.freeze({
          ...card,
          source: freezeDashboardCardSource(card.source)
        })
      )
    )
  });
}

export function assertDashboardDefinition(definition: DashboardDefinition): void {
  assertDashboardIdentifier(definition.name, "dashboard name");
  if (definition.cards.length === 0) {
    throw new FrameworkError(
      "DASHBOARD_INVALID",
      `Dashboard '${definition.name}' must define at least one card`,
      { status: 400 }
    );
  }
  assertUnique(definition.cards.map((card) => card.name), "card", definition.name);
  for (const card of definition.cards) {
    assertDashboardIdentifier(card.name, "dashboard card name");
    assertDashboardCardSource(definition.name, card);
  }
}

export function canReadDashboard(actor: Actor, dashboard: DashboardDefinition): boolean {
  if (actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return true;
  }
  return dashboard.roles === undefined || dashboard.roles.some((role) => actor.roles.includes(role));
}

function freezeDashboardCardSource(source: DashboardCardSourceDefinition): DashboardCardSourceDefinition {
  if (source.kind === "documentCount") {
    return Object.freeze({
      ...source,
      ...(source.filters
        ? {
            filters: Object.freeze(
              source.filters.map((filter) => Object.freeze({ ...filter }))
            )
          }
        : {})
    });
  }
  return Object.freeze({
    ...source,
    ...(source.filters ? { filters: Object.freeze({ ...source.filters }) } : {})
  });
}

function assertDashboardCardSource(dashboardName: string, card: DashboardCardDefinition): void {
  const source = card.source;
  if (source.kind === "documentCount") {
    assertDashboardIdentifier(source.doctype, `dashboard '${dashboardName}' card '${card.name}' DocType`);
    return;
  }
  if (source.kind === "reportSummary") {
    assertDashboardIdentifier(source.report, `dashboard '${dashboardName}' card '${card.name}' report`);
    assertDashboardIdentifier(source.summary, `dashboard '${dashboardName}' card '${card.name}' summary`);
    return;
  }
  throw new FrameworkError(
    "DASHBOARD_INVALID",
    `Dashboard '${dashboardName}' card '${card.name}' has invalid source`,
    { status: 400 }
  );
}

function assertDashboardIdentifier(value: string, label: string): void {
  if (!value.trim()) {
    throw new FrameworkError("DASHBOARD_INVALID", `${label} is required`, { status: 400 });
  }
}

function assertUnique(values: readonly string[], label: string, dashboardName: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new FrameworkError(
        "DASHBOARD_INVALID",
        `Dashboard '${dashboardName}' has duplicate ${label} '${value}'`,
        { status: 400 }
      );
    }
    seen.add(value);
  }
}
