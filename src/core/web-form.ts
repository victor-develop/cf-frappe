import { FrameworkError } from "./errors.js";
import { GUEST_ROLE, SYSTEM_MANAGER_ROLE, type Actor, type DocTypeDefinition, type FieldDefinition } from "./types.js";
import { isSafeWebsiteHref } from "./website-href.js";
import { isCanonicalWebPageRoute } from "./web-page.js";

export interface WebFormFieldDefinition {
  readonly field: string;
  readonly label?: string;
  readonly description?: string;
  readonly required?: boolean;
}

export interface WebFormDefinition {
  readonly name: string;
  readonly label?: string;
  readonly route?: string;
  readonly module?: string;
  readonly description?: string;
  readonly roles?: readonly string[];
  readonly published?: boolean;
  readonly loginRequired?: boolean;
  readonly doctype: string;
  readonly fields: readonly WebFormFieldDefinition[];
  readonly submitLabel?: string;
  readonly successMessage?: string;
  readonly successUrl?: string;
}

export function defineWebForm(definition: WebFormDefinition): WebFormDefinition {
  assertWebFormDefinition(definition);
  return Object.freeze({
    ...definition,
    ...(definition.roles === undefined ? {} : { roles: Object.freeze([...definition.roles]) }),
    fields: Object.freeze(definition.fields.map((field) => Object.freeze({ ...field })))
  });
}

export function assertWebFormDefinition(definition: WebFormDefinition): void {
  assertWebFormIdentifier(definition.name, "web form name");
  assertWebFormIdentifier(definition.doctype, `web form '${definition.name}' DocType`);
  if (definition.route !== undefined) {
    assertWebFormRoute(definition.route, definition.name);
  }
  if (definition.successUrl !== undefined) {
    assertWebFormSuccessUrl(definition.successUrl, definition.name);
  }
  if (!Array.isArray(definition.fields) || definition.fields.length === 0) {
    throw new FrameworkError("WEB_FORM_INVALID", `Web form '${definition.name}' fields must not be empty`, {
      status: 400
    });
  }
  const seen = new Set<string>();
  for (const field of definition.fields) {
    assertWebFormIdentifier(field.field, `web form '${definition.name}' field`);
    if (seen.has(field.field)) {
      throw new FrameworkError("WEB_FORM_INVALID", `Web form '${definition.name}' has duplicate field '${field.field}'`, {
        status: 400
      });
    }
    seen.add(field.field);
  }
}

function assertWebFormRoute(route: string, formName: string): void {
  assertWebFormIdentifier(route, `web form '${formName}' route`);
  if (!isCanonicalWebPageRoute(route)) {
    throw new FrameworkError("WEB_FORM_INVALID", `Web form '${formName}' route must be a safe canonical relative path`, {
      status: 400
    });
  }
}

function assertWebFormSuccessUrl(successUrl: string, formName: string): void {
  assertWebFormIdentifier(successUrl, `web form '${formName}' success URL`);
  if (!isSafeWebsiteHref(successUrl)) {
    throw new FrameworkError("WEB_FORM_INVALID", `Web form '${formName}' success URL must be a safe href`, {
      status: 400
    });
  }
}

export function assertWebFormMatchesDocType(webForm: WebFormDefinition, doctype: DocTypeDefinition): void {
  if (webForm.doctype !== doctype.name) {
    throw new FrameworkError(
      "WEB_FORM_INVALID",
      `Web form '${webForm.name}' references DocType '${webForm.doctype}' but was checked against '${doctype.name}'`,
      { status: 400 }
    );
  }
  for (const formField of webForm.fields) {
    const field = doctype.fields.find((candidate) => candidate.name === formField.field);
    assertSubmittableWebFormField(webForm, doctype, formField.field, field);
  }
}

export function canReadWebForm(actor: Actor, webForm: WebFormDefinition): boolean {
  if (actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return true;
  }
  if (webForm.loginRequired === true && !hasAuthenticatedRole(actor)) {
    return false;
  }
  return webForm.roles === undefined || webForm.roles.some((role) => actor.roles.includes(role));
}

function hasAuthenticatedRole(actor: Actor): boolean {
  return actor.roles.some((role) => role !== GUEST_ROLE);
}

function assertSubmittableWebFormField(
  webForm: WebFormDefinition,
  doctype: DocTypeDefinition,
  fieldName: string,
  field: FieldDefinition | undefined
): void {
  if (!field) {
    throw new FrameworkError(
      "WEB_FORM_INVALID",
      `Web form '${webForm.name}' references unknown field '${fieldName}' on DocType '${doctype.name}'`,
      { status: 400 }
    );
  }
  if (field.hidden) {
    throw new FrameworkError(
      "WEB_FORM_INVALID",
      `Web form '${webForm.name}' field '${fieldName}' must not be hidden`,
      { status: 400 }
    );
  }
  if (field.readOnly) {
    throw new FrameworkError(
      "WEB_FORM_INVALID",
      `Web form '${webForm.name}' field '${fieldName}' must not be read-only`,
      { status: 400 }
    );
  }
  if (field.type === "table") {
    throw new FrameworkError(
      "WEB_FORM_INVALID",
      `Web form '${webForm.name}' field '${fieldName}' cannot be a table field`,
      { status: 400 }
    );
  }
}

function assertWebFormIdentifier(value: string, label: string): void {
  if (!value.trim()) {
    throw new FrameworkError("WEB_FORM_INVALID", `${label} is required`, { status: 400 });
  }
}
