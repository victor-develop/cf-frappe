import { permissionDenied } from "../core/errors.js";
import { assertWebFormMatchesDocType, canReadWebForm, type WebFormDefinition } from "../core/web-form.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor, DocTypeDefinition } from "../core/types.js";
import type { DocumentService } from "./document-service.js";
import type { QueryService } from "./query-service.js";
import {
  isPublishedWebFormForActor,
  resolveWebFormMetadata,
  webFormSubmissionData,
  webFormSubmitResult,
  type WebFormMetadata,
  type WebFormSubmitInput,
  type WebFormSubmitResult
} from "./web-form-policy.js";

export type { WebFormMetadata, WebFormResolvedField, WebFormSubmitInput, WebFormSubmitResult } from "./web-form-policy.js";

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
    return resolveWebFormMetadata(webForm, doctype);
  }

  async submitWebForm(
    actor: Actor,
    webFormName: string,
    input: WebFormSubmitInput
  ): Promise<WebFormSubmitResult> {
    const metadata = await this.getWebForm(actor, webFormName);
    const data = webFormSubmissionData(metadata, input);
    const document = await this.documents.create({
      actor,
      doctype: metadata.doctype,
      data,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata })
    });
    return webFormSubmitResult(metadata, document);
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
