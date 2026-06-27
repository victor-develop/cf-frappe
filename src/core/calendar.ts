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
  type FieldDefinition,
  type ListDocumentsFilter,
  type ListFilterExpression
} from "./types.js";

export interface CalendarDefinition {
  readonly name: string;
  readonly label?: string;
  readonly module?: string;
  readonly description?: string;
  readonly roles?: readonly string[];
  readonly doctype: string;
  readonly startField: string;
  readonly endField?: string;
  readonly titleField?: string;
  readonly allDayField?: string;
  readonly colorField?: string;
  readonly filters?: readonly ListDocumentsFilter[];
  readonly filterExpression?: ListFilterExpression;
  readonly maxEvents?: number;
}

export function defineCalendar(definition: CalendarDefinition): CalendarDefinition {
  assertCalendarDefinition(definition);
  return Object.freeze({
    ...definition,
    ...(definition.roles === undefined ? {} : { roles: Object.freeze([...definition.roles]) }),
    ...(definition.filters === undefined
      ? {}
      : { filters: Object.freeze(definition.filters.map(freezeListFilter)) }),
    ...(definition.filterExpression === undefined
      ? {}
      : { filterExpression: freezeListFilterExpression(definition.filterExpression) })
  });
}

export function assertCalendarDefinition(definition: CalendarDefinition): void {
  assertCalendarIdentifier(definition.name, "calendar name");
  assertCalendarIdentifier(definition.doctype, `calendar '${definition.name}' DocType`);
  assertCalendarIdentifier(definition.startField, `calendar '${definition.name}' start field`);
  if (definition.endField !== undefined) {
    assertCalendarIdentifier(definition.endField, `calendar '${definition.name}' end field`);
  }
  if (definition.titleField !== undefined) {
    assertCalendarIdentifier(definition.titleField, `calendar '${definition.name}' title field`);
  }
  if (definition.allDayField !== undefined) {
    assertCalendarIdentifier(definition.allDayField, `calendar '${definition.name}' all-day field`);
  }
  if (definition.colorField !== undefined) {
    assertCalendarIdentifier(definition.colorField, `calendar '${definition.name}' color field`);
  }
  if (definition.filterExpression !== undefined) {
    assertListFilterExpressionShape(definition.filterExpression, {
      errorCode: "CALENDAR_INVALID",
      label: `Calendar '${definition.name}' filter expression`
    });
  }
  if (
    definition.maxEvents !== undefined &&
    (!Number.isInteger(definition.maxEvents) || definition.maxEvents < 1 || definition.maxEvents > 500)
  ) {
    throw new FrameworkError(
      "CALENDAR_INVALID",
      `Calendar '${definition.name}' maxEvents must be an integer between 1 and 500`,
      { status: 400 }
    );
  }
}

export function assertCalendarMatchesDocType(calendar: CalendarDefinition, doctype: DocTypeDefinition): void {
  if (calendar.doctype !== doctype.name) {
    throw new FrameworkError(
      "CALENDAR_INVALID",
      `Calendar '${calendar.name}' references DocType '${calendar.doctype}' but was checked against '${doctype.name}'`,
      { status: 400 }
    );
  }
  assertDateField(calendar, doctype, calendar.startField, "start");
  if (calendar.endField !== undefined) {
    assertDateField(calendar, doctype, calendar.endField, "end");
  }
  if (calendar.titleField !== undefined) {
    assertVisibleField(calendar, doctype, calendar.titleField, "title");
  }
  if (calendar.allDayField !== undefined) {
    const field = assertVisibleField(calendar, doctype, calendar.allDayField, "all-day");
    if (field.type !== "boolean") {
      throw new FrameworkError(
        "CALENDAR_INVALID",
        `Calendar '${calendar.name}' all-day field '${calendar.allDayField}' must be a boolean field`,
        { status: 400 }
      );
    }
  }
  if (calendar.colorField !== undefined) {
    const field = assertVisibleField(calendar, doctype, calendar.colorField, "color");
    if (field.type !== "select" && field.type !== "text") {
      throw new FrameworkError(
        "CALENDAR_INVALID",
        `Calendar '${calendar.name}' color field '${calendar.colorField}' must be a select or text field`,
        { status: 400 }
      );
    }
  }
  normalizeListFilters(doctype, calendar.filters ?? [], { errorCode: "CALENDAR_INVALID" });
  if (calendar.filterExpression !== undefined) {
    normalizeListFilterExpression(doctype, calendar.filterExpression, { errorCode: "CALENDAR_INVALID" });
  }
}

export function canReadCalendar(actor: Actor, calendar: CalendarDefinition): boolean {
  if (actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return true;
  }
  return calendar.roles === undefined || calendar.roles.some((role) => actor.roles.includes(role));
}

function assertDateField(
  calendar: CalendarDefinition,
  doctype: DocTypeDefinition,
  fieldName: string,
  role: "start" | "end"
): FieldDefinition {
  const field = assertVisibleField(calendar, doctype, fieldName, role);
  if (field.type !== "date" && field.type !== "datetime") {
    throw new FrameworkError(
      "CALENDAR_INVALID",
      `Calendar '${calendar.name}' ${role} field '${fieldName}' must be a date or datetime field`,
      { status: 400 }
    );
  }
  return field;
}

function assertVisibleField(
  calendar: CalendarDefinition,
  doctype: DocTypeDefinition,
  fieldName: string,
  role: string
): FieldDefinition {
  const field = doctype.fields.find((candidate) => candidate.name === fieldName);
  if (!field) {
    throw new FrameworkError(
      "CALENDAR_INVALID",
      `Calendar '${calendar.name}' references unknown ${role} field '${fieldName}' on DocType '${doctype.name}'`,
      { status: 400 }
    );
  }
  if (field.hidden) {
    throw new FrameworkError(
      "CALENDAR_INVALID",
      `Calendar '${calendar.name}' ${role} field '${fieldName}' must not be hidden`,
      { status: 400 }
    );
  }
  return field;
}

function assertCalendarIdentifier(value: string, label: string): void {
  if (!value.trim()) {
    throw new FrameworkError("CALENDAR_INVALID", `${label} is required`, { status: 400 });
  }
}
