import { FrameworkError } from "./errors.js";
import {
  assertListFilterExpressionShape,
  freezeListFilter,
  freezeListFilterExpression,
  normalizeListFilterExpression,
  normalizeListFilters
} from "./list-view.js";
import {
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocTypeDefinition,
  type ListDocumentsFilter,
  type ListFilterExpression
} from "./types.js";

export interface KanbanColumnDefinition {
  readonly value: string;
  readonly label?: string;
  readonly indicator?: string;
}

export interface KanbanDefinition {
  readonly name: string;
  readonly label?: string;
  readonly module?: string;
  readonly description?: string;
  readonly roles?: readonly string[];
  readonly doctype: string;
  readonly columnField: string;
  readonly titleField?: string;
  readonly filters?: readonly ListDocumentsFilter[];
  readonly filterExpression?: ListFilterExpression;
  readonly columns?: readonly KanbanColumnDefinition[];
  readonly maxCardsPerColumn?: number;
}

export function defineKanban(definition: KanbanDefinition): KanbanDefinition {
  assertKanbanDefinition(definition);
  return Object.freeze({
    ...definition,
    ...(definition.roles === undefined ? {} : { roles: Object.freeze([...definition.roles]) }),
    ...(definition.filters === undefined
      ? {}
      : { filters: Object.freeze(definition.filters.map(freezeListFilter)) }),
    ...(definition.filterExpression === undefined
      ? {}
      : { filterExpression: freezeListFilterExpression(definition.filterExpression) }),
    ...(definition.columns === undefined
      ? {}
      : { columns: Object.freeze(definition.columns.map((column) => Object.freeze({ ...column }))) })
  });
}

export function assertKanbanDefinition(definition: KanbanDefinition): void {
  assertKanbanIdentifier(definition.name, "kanban name");
  assertKanbanIdentifier(definition.doctype, `kanban '${definition.name}' DocType`);
  assertKanbanIdentifier(definition.columnField, `kanban '${definition.name}' column field`);
  if (definition.titleField !== undefined) {
    assertKanbanIdentifier(definition.titleField, `kanban '${definition.name}' title field`);
  }
  if (definition.filterExpression !== undefined) {
    assertListFilterExpressionShape(definition.filterExpression, {
      errorCode: "KANBAN_INVALID",
      label: `Kanban '${definition.name}' filter expression`
    });
  }
  if (definition.columns !== undefined) {
    if (definition.columns.length === 0) {
      throw new FrameworkError("KANBAN_INVALID", `Kanban '${definition.name}' columns must not be empty`, {
        status: 400
      });
    }
    assertUnique(definition.columns.map((column) => column.value), "column", definition.name);
    for (const column of definition.columns) {
      assertKanbanIdentifier(column.value, `kanban '${definition.name}' column value`);
    }
  }
  if (
    definition.maxCardsPerColumn !== undefined &&
    (!Number.isInteger(definition.maxCardsPerColumn) || definition.maxCardsPerColumn < 1 || definition.maxCardsPerColumn > 200)
  ) {
    throw new FrameworkError(
      "KANBAN_INVALID",
      `Kanban '${definition.name}' maxCardsPerColumn must be an integer between 1 and 200`,
      { status: 400 }
    );
  }
}

export function assertKanbanMatchesDocType(kanban: KanbanDefinition, doctype: DocTypeDefinition): void {
  if (kanban.doctype !== doctype.name) {
    throw new FrameworkError(
      "KANBAN_INVALID",
      `Kanban '${kanban.name}' references DocType '${kanban.doctype}' but was checked against '${doctype.name}'`,
      { status: 400 }
    );
  }
  const columnField = doctype.fields.find((field) => field.name === kanban.columnField);
  if (!columnField) {
    throw new FrameworkError(
      "KANBAN_INVALID",
      `Kanban '${kanban.name}' references unknown column field '${kanban.columnField}' on DocType '${doctype.name}'`,
      { status: 400 }
    );
  }
  if (columnField.hidden) {
    throw new FrameworkError(
      "KANBAN_INVALID",
      `Kanban '${kanban.name}' column field '${kanban.columnField}' must not be hidden`,
      { status: 400 }
    );
  }
  if (columnField.type !== "select" && columnField.type !== "text") {
    throw new FrameworkError(
      "KANBAN_INVALID",
      `Kanban '${kanban.name}' column field '${kanban.columnField}' must be a select or text field`,
      { status: 400 }
    );
  }
  if (columnField.type === "select" && kanban.columns !== undefined) {
    const options = new Set(columnField.options ?? []);
    for (const column of kanban.columns) {
      if (!options.has(column.value)) {
        throw new FrameworkError(
          "KANBAN_INVALID",
          `Kanban '${kanban.name}' column '${column.value}' is not an option of '${kanban.columnField}'`,
          { status: 400 }
        );
      }
    }
  }
  if (kanban.columns === undefined && (columnField.type !== "select" || (columnField.options ?? []).length === 0)) {
    throw new FrameworkError(
      "KANBAN_INVALID",
      `Kanban '${kanban.name}' must define columns unless '${kanban.columnField}' has select options`,
      { status: 400 }
    );
  }
  if (kanban.titleField !== undefined) {
    const titleField = doctype.fields.find((field) => field.name === kanban.titleField);
    if (!titleField) {
      throw new FrameworkError(
        "KANBAN_INVALID",
        `Kanban '${kanban.name}' references unknown title field '${kanban.titleField}' on DocType '${doctype.name}'`,
        { status: 400 }
      );
    }
    if (titleField.hidden) {
      throw new FrameworkError(
        "KANBAN_INVALID",
        `Kanban '${kanban.name}' title field '${kanban.titleField}' must not be hidden`,
        { status: 400 }
      );
    }
  }
  normalizeListFilters(doctype, kanban.filters ?? [], { errorCode: "KANBAN_INVALID" });
  if (kanban.filterExpression !== undefined) {
    normalizeListFilterExpression(doctype, kanban.filterExpression, { errorCode: "KANBAN_INVALID" });
  }
}

export function kanbanColumnsForDocType(
  kanban: KanbanDefinition,
  doctype: DocTypeDefinition
): readonly KanbanColumnDefinition[] {
  if (kanban.columns !== undefined) {
    return kanban.columns;
  }
  const field = doctype.fields.find((candidate) => candidate.name === kanban.columnField);
  return (field?.options ?? []).map((value) => ({ value }));
}

export function canReadKanban(actor: Actor, kanban: KanbanDefinition): boolean {
  if (actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return true;
  }
  return kanban.roles === undefined || kanban.roles.some((role) => actor.roles.includes(role));
}

function assertKanbanIdentifier(value: string, label: string): void {
  if (!value.trim()) {
    throw new FrameworkError("KANBAN_INVALID", `${label} is required`, { status: 400 });
  }
}

function assertUnique(values: readonly string[], label: string, kanbanName: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new FrameworkError("KANBAN_INVALID", `Kanban '${kanbanName}' has duplicate ${label} '${value}'`, {
        status: 400
      });
    }
    seen.add(value);
  }
}
