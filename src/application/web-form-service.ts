import { permissionDenied } from "../core/errors.js";
import { assertWebFormMatchesDocType, type WebFormDefinition } from "../core/web-form.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor, DocTypeDefinition } from "../core/types.js";
import type { DocumentService } from "./document-service.js";
import type { QueryService } from "./query-service.js";
import { isPermissionDeniedError } from "./access-policy.js";
import {
  isPublishedWebFormForActor,
  planWebFormAccess,
  resolveWebFormMetadata,
  webFormSubmissionData,
  webFormSubmitResult,
  type WebFormAccessDecision,
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
      if ((await this.webFormAccess(actor, webForm)).status === "allow") {
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
    const decision = await this.webFormAccess(actor, webForm);
    if (decision.status === "deny") {
      throw permissionDenied(decision.message);
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

  private async webFormAccess(actor: Actor, webForm: WebFormDefinition): Promise<WebFormAccessDecision> {
    const preflight = planWebFormAccess({ actor, form: webForm, createMetadataReadable: true });
    if (preflight.status === "deny" || !isPublishedWebFormForActor(actor, webForm)) {
      return preflight;
    }
    try {
      await this.createMetaFor(actor, webForm);
      return preflight;
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        return planWebFormAccess({ actor, form: webForm, createMetadataReadable: false });
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
