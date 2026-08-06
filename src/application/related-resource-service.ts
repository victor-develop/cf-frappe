import { FrameworkError } from "../core/errors.js";
import type {
  Actor,
  DocTypeDefinition,
  DocumentSnapshot,
  FieldDefinition
} from "../core/types.js";
import type { PrintService } from "./print-service.js";
import type { QueryService } from "./query-service.js";

export type RelatedDocTypeDirection = "incoming" | "outgoing";

export interface RelatedDocTypeResource {
  readonly kind: "doctype";
  readonly direction: RelatedDocTypeDirection;
  readonly doctype: string;
  readonly doctypeLabel: string;
  readonly module?: string;
  readonly field: string;
  readonly fieldLabel: string;
  readonly linkedDocumentName?: string;
}

export interface RelatedPrintFormatResource {
  readonly kind: "print-format";
  readonly name: string;
  readonly label: string;
  readonly module?: string;
  readonly description?: string;
}

export interface RelatedResourcesView {
  readonly doctype: string;
  readonly documentName?: string;
  readonly doctypes: readonly RelatedDocTypeResource[];
  readonly printFormats: readonly RelatedPrintFormatResource[];
}

export interface RelatedResourceServiceOptions {
  readonly queries: QueryService;
  readonly prints?: Pick<PrintService, "listPrintFormats">;
}

export class RelatedResourceService {
  private readonly queries: QueryService;
  private readonly prints: Pick<PrintService, "listPrintFormats"> | undefined;

  constructor(options: RelatedResourceServiceOptions) {
    this.queries = options.queries;
    this.prints = options.prints;
  }

  async forDocType(
    actor: Actor,
    doctypeName: string
  ): Promise<RelatedResourcesView> {
    return this.project(actor, doctypeName);
  }

  async forDocument(
    actor: Actor,
    doctypeName: string,
    documentName: string
  ): Promise<RelatedResourcesView> {
    const document = await this.queries.getDocument(actor, doctypeName, documentName);
    const resources = await this.project(actor, doctypeName);
    const doctypes = await Promise.all(resources.doctypes.map((resource) =>
      this.withReadableLinkedDocument(actor, document, resource)
    ));
    return {
      ...resources,
      documentName: document.name,
      doctypes
    };
  }

  private async project(
    actor: Actor,
    doctypeName: string
  ): Promise<RelatedResourcesView> {
    const doctypes = await this.queries.listEffectiveQueryDoctypes(actor);
    const byName = new Map(doctypes.map((doctype) => [doctype.name, doctype]));
    const selected = byName.get(doctypeName) ?? await this.queries.getEffectiveQueryMeta(actor, doctypeName);
    const relatedDoctypes = [
      ...outgoingResources(selected, byName),
      ...incomingResources(selected, doctypes)
    ].sort(compareRelatedDocTypes);
    const printFormats = (this.prints?.listPrintFormats(actor, selected.name) ?? [])
      .map((format): RelatedPrintFormatResource => ({
        kind: "print-format",
        name: format.name,
        label: format.label ?? format.name,
        ...(format.module === undefined ? {} : { module: format.module }),
        ...(format.description === undefined ? {} : { description: format.description })
      }))
      .sort((left, right) => left.label.localeCompare(right.label) || left.name.localeCompare(right.name));
    return {
      doctype: selected.name,
      doctypes: relatedDoctypes,
      printFormats
    };
  }

  private async withReadableLinkedDocument(
    actor: Actor,
    document: DocumentSnapshot,
    resource: RelatedDocTypeResource
  ): Promise<RelatedDocTypeResource> {
    if (resource.direction !== "outgoing") {
      return resource;
    }
    const value = document.data[resource.field];
    if (typeof value !== "string" || value.trim() === "") {
      return resource;
    }
    try {
      const linked = await this.queries.getDocument(actor, resource.doctype, value);
      return { ...resource, linkedDocumentName: linked.name };
    } catch (error) {
      if (error instanceof FrameworkError && (error.status === 403 || error.status === 404)) {
        return resource;
      }
      throw error;
    }
  }
}

function outgoingResources(
  selected: DocTypeDefinition,
  byName: ReadonlyMap<string, DocTypeDefinition>
): RelatedDocTypeResource[] {
  return selected.fields.flatMap((field) => {
    if (field.type !== "link" || field.linkTo === undefined ||
      !relatedFieldIsVisible(field)) {
      return [];
    }
    const target = byName.get(field.linkTo);
    if (target === undefined) {
      return [];
    }
    return [{
      kind: "doctype" as const,
      direction: "outgoing" as const,
      doctype: target.name,
      doctypeLabel: target.label ?? target.name,
      ...(target.module === undefined ? {} : { module: target.module }),
      field: field.name,
      fieldLabel: field.label ?? field.name
    }];
  });
}

function incomingResources(
  selected: DocTypeDefinition,
  doctypes: readonly DocTypeDefinition[]
): RelatedDocTypeResource[] {
  return doctypes.flatMap((source) => {
    return source.fields.flatMap((field) => {
      if (field.type !== "link" || field.linkTo !== selected.name ||
        !relatedFieldIsVisible(field)) {
        return [];
      }
      return [{
        kind: "doctype" as const,
        direction: "incoming" as const,
        doctype: source.name,
        doctypeLabel: source.label ?? source.name,
        ...(source.module === undefined ? {} : { module: source.module }),
        field: field.name,
        fieldLabel: field.label ?? field.name
      }];
    });
  });
}

function relatedFieldIsVisible(
  field: FieldDefinition
): boolean {
  return field.hidden !== true && field.hiddenDependsOn === undefined;
}

function compareRelatedDocTypes(left: RelatedDocTypeResource, right: RelatedDocTypeResource): number {
  return left.direction.localeCompare(right.direction) ||
    left.doctypeLabel.localeCompare(right.doctypeLabel) ||
    left.fieldLabel.localeCompare(right.fieldLabel) ||
    left.field.localeCompare(right.field);
}
