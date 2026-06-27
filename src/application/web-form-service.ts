import { badRequest, permissionDenied } from "../core/errors.js";
import { assertWebFormMatchesDocType, canReadWebForm, type WebFormDefinition } from "../core/web-form.js";
import type { ModelRegistry } from "../core/registry.js";
import { SYSTEM_MANAGER_ROLE, type Actor, type DocTypeDefinition, type DocumentData, type DocumentSnapshot, type FieldDefinition, type JsonValue, type MutableDocumentData } from "../core/types.js";
import type { DocumentService } from "./document-service.js";
import type { QueryService } from "./query-service.js";

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

export interface WebFormServiceOptions {
  readonly registry: ModelRegistry;
  readonly documents: Pick<DocumentService, "create">;
  readonly queries: QueryService;
}

export class WebFormService {
  private readonly registry: ModelRegistry;
  private readonly documents: Pick<DocumentService, "create">;
  private readonly queries: QueryService;

  constructor(options: WebFormServiceOptions) {
    this.registry = options.registry;
    this.documents = options.documents;
    this.queries = options.queries;
  }

  async listWebForms(actor: Actor): Promise<readonly WebFormDefinition[]> {
    const readable: WebFormDefinition[] = [];
    for (const webForm of this.registry.listWebForms()) {
      if (await this.canAccessWebForm(actor, webForm)) {
        readable.push(webForm);
      }
    }
    return readable;
  }

  async getWebForm(actor: Actor, webFormName: string): Promise<WebFormMetadata> {
    const webForm = this.registry.getWebForm(webFormName);
    return this.resolveWebForm(actor, webForm);
  }

  async getWebFormByRoute(actor: Actor, route: string): Promise<WebFormMetadata> {
    const webForm = this.registry.getWebFormByRoute(route);
    return this.resolveWebForm(actor, webForm);
  }

  private async resolveWebForm(actor: Actor, webForm: WebFormDefinition): Promise<WebFormMetadata> {
    if (!(await this.canAccessWebForm(actor, webForm))) {
      throw permissionDenied(`Actor '${actor.id}' cannot submit web form '${webForm.name}'`);
    }
    const doctype = await this.createMetaFor(actor, webForm);
    return {
      form: webForm,
      doctype: doctype.name,
      fields: webForm.fields.map((formField) => {
        const field = doctype.fields.find((candidate) => candidate.name === formField.field);
        if (field === undefined) {
          throw new Error(`Registry accepted web form '${webForm.name}' with missing field '${formField.field}'`);
        }
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
      })
    };
  }

  async submitWebForm(
    actor: Actor,
    webFormName: string,
    input: WebFormSubmitInput
  ): Promise<WebFormSubmitResult> {
    const metadata = await this.getWebForm(actor, webFormName);
    const data: MutableDocumentData = {};
    for (const field of metadata.fields) {
      data[field.field] = input.data[field.field];
      if (field.required && isMissingRequiredValue(data[field.field])) {
        throw badRequest(`Web form field '${field.field}' is required`);
      }
    }
    const document = await this.documents.create({
      actor,
      doctype: metadata.doctype,
      data,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata })
    });
    return {
      form: metadata.form,
      document
    };
  }

  private async canAccessWebForm(actor: Actor, webForm: WebFormDefinition): Promise<boolean> {
    if (!isPublishedWebFormForActor(actor, webForm)) {
      return false;
    }
    if (!canReadWebForm(actor, webForm)) {
      return false;
    }
    try {
      await this.createMetaFor(actor, webForm);
      return true;
    } catch (error) {
      if (isPermissionDenied(error)) {
        return false;
      }
      throw error;
    }
  }

  private async createMetaFor(actor: Actor, webForm: WebFormDefinition): Promise<DocTypeDefinition> {
    const doctype = await this.queries.getEffectiveCreateMeta(actor, webForm.doctype);
    assertWebFormMatchesDocType(webForm, doctype);
    return doctype;
  }
}

function isPermissionDenied(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "PERMISSION_DENIED";
}

function isPublishedWebFormForActor(actor: Actor, webForm: WebFormDefinition): boolean {
  return webForm.published !== false || actor.roles.includes(SYSTEM_MANAGER_ROLE);
}

function isMissingRequiredValue(value: JsonValue | undefined): boolean {
  return value === undefined || value === null || value === "";
}
