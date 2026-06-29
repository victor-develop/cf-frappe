import { FrameworkError, validationFailed } from "../core/errors.js";
import type { DocTypeDefinition, DocumentData, DocumentSnapshot, NewDomainEvent } from "../core/types.js";
import type { IdGenerator } from "../ports/id-generator.js";
import {
  documentCreatedPayload,
  documentUpdatedPayload,
  type DocumentLifecycleEventPayload
} from "./document-lifecycle-events.js";

export const NAMING_SERIES_DOCTYPE = "__NamingSeries";

export interface NamingSeriesEventPlan {
  readonly eventType: "NamingSeriesStarted" | "NamingSeriesAdvanced";
  readonly documentName: string;
  readonly payload: Extract<DocumentLifecycleEventPayload, { readonly kind: "DocumentCreated" | "DocumentUpdated" }>;
  readonly metadata: DocumentData;
}

export function resolveDocumentName(
  doctype: DocTypeDefinition,
  data: DocumentData,
  ids: IdGenerator
): string {
  const naming = doctype.naming ?? { kind: "uuid" };
  if (naming.kind === "uuid") {
    return ids.next("doc_");
  }
  if (naming.kind === "field") {
    const value = data[naming.field];
    if (typeof value !== "string" || value.length === 0) {
      throw validationFailed([
        {
          field: naming.field,
          code: "name",
          message: `Field '${naming.field}' must be a non-empty string to name ${doctype.name}`
        }
      ]);
    }
    return value;
  }
  if (naming.kind === "series") {
    throw new FrameworkError("DOCTYPE_NAMING_INVALID", `Naming series for ${doctype.name} needs a document store`, {
      status: 500
    });
  }
  const field = naming.field ?? "name";
  const value = data[field];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return ids.next("doc_");
}

export function ensureCreateNameAllowed(doctype: DocTypeDefinition, name: string | undefined): void {
  if (name === undefined || doctype.naming?.kind !== "series") {
    return;
  }
  throw validationFailed([
    {
      field: "name",
      code: "name",
      message: `${doctype.name} uses a naming series and cannot be created with an explicit name`
    }
  ]);
}

export function renderNamingSeries(pattern: string, value: number): string {
  return pattern.replace(/#+/, (placeholder) => String(value).padStart(placeholder.length, "0"));
}

export function namingSeriesCurrentValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function planNamingSeriesEvent(input: {
  readonly doctypeName: string;
  readonly pattern: string;
  readonly next: number;
  readonly existing: DocumentSnapshot | null;
}): NamingSeriesEventPlan {
  return {
    eventType: input.existing ? "NamingSeriesAdvanced" : "NamingSeriesStarted",
    documentName: `${input.doctypeName}:${input.pattern}`,
    payload: input.existing
      ? documentUpdatedPayload({ current: input.next })
      : documentCreatedPayload({ doctype: input.doctypeName, pattern: input.pattern, current: input.next }, "draft"),
    metadata: { target_doctype: input.doctypeName }
  };
}

export function namingSeriesEventCommand(input: {
  readonly tenantId: string;
  readonly stream: string;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly plan: NamingSeriesEventPlan;
}): Omit<NewDomainEvent<NamingSeriesEventPlan["payload"]>, "id" | "sequence"> {
  return {
    tenantId: input.tenantId,
    stream: input.stream,
    type: input.plan.eventType,
    doctype: NAMING_SERIES_DOCTYPE,
    documentName: input.plan.documentName,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    payload: input.plan.payload,
    metadata: input.plan.metadata
  };
}
