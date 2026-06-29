import { badRequest } from "../core/errors.js";
import { SYSTEM_MANAGER_ROLE, type Actor, type DocTypeDefinition, type DocumentData, type DocumentSnapshot, type FieldDefinition, type JsonValue, type MutableDocumentData } from "../core/types.js";
import type { WebFormDefinition } from "../core/web-form.js";

export interface WebFormResolvedField {
  readonly field: string;
  readonly label: string;
  readonly description?: string;
  readonly placeholder?: string;
  readonly type: FieldDefinition["type"];
  readonly required: boolean;
  readonly options?: readonly string[];
  readonly linkTo?: string;
}

export interface WebFormMetadata {
  readonly form: WebFormDefinition;
  readonly doctype: string;
  readonly fields: readonly WebFormResolvedField[];
}

export interface WebFormSubmitInput {
  readonly data: Readonly<Record<string, JsonValue | undefined>>;
  readonly metadata?: DocumentData;
}

export interface WebFormSubmitResult {
  readonly form: WebFormDefinition;
  readonly document: DocumentSnapshot;
}

export function isPublishedWebFormForActor(actor: Actor, form: WebFormDefinition): boolean {
  return form.published !== false || actor.roles.includes(SYSTEM_MANAGER_ROLE);
}

export function resolveWebFormMetadata(
  form: WebFormDefinition,
  doctype: DocTypeDefinition
): WebFormMetadata {
  return {
    form,
    doctype: doctype.name,
    fields: form.fields.map((formField) => {
      const field = doctype.fields.find((candidate) => candidate.name === formField.field);
      if (field === undefined) {
        throw new Error(`Registry accepted web form '${form.name}' with missing field '${formField.field}'`);
      }
      return resolveWebFormField(formField, field);
    })
  };
}

export function webFormSubmissionData(
  metadata: WebFormMetadata,
  input: WebFormSubmitInput
): MutableDocumentData {
  const data: MutableDocumentData = {};
  for (const field of metadata.fields) {
    data[field.field] = input.data[field.field];
    if (field.required && isMissingRequiredWebFormValue(data[field.field])) {
      throw badRequest(`Web form field '${field.field}' is required`);
    }
  }
  return data;
}

export function webFormSubmitResult(
  metadata: Pick<WebFormMetadata, "form">,
  document: DocumentSnapshot
): WebFormSubmitResult {
  return {
    form: metadata.form,
    document
  };
}

export function isMissingRequiredWebFormValue(value: JsonValue | undefined): boolean {
  return value === undefined || value === null || value === "";
}

function resolveWebFormField(
  formField: WebFormDefinition["fields"][number],
  field: FieldDefinition
): WebFormResolvedField {
  return {
    field: field.name,
    label: formField.label ?? field.label ?? field.name,
    ...(formField.description === undefined ? {} : { description: formField.description }),
    ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
    type: field.type,
    required: formField.required ?? field.required ?? false,
    ...(field.options === undefined ? {} : { options: field.options }),
    ...(field.linkTo === undefined ? {} : { linkTo: field.linkTo })
  };
}
