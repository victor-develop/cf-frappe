/**
 * Typed seams between the ported CORE (context/http/bodies/topics/namespace/boot)
 * and the behavior modules that land later in parallel:
 *
 * - uploads        (file upload machinery: preflight, direct upload, multipart chunking/abort,
 *                   upload-form hydration)
 * - filter/formula (compound filter builder + report formula builder hydration)
 * - form           (form binding + `frm` API, conditional visibility DSL)
 * - realtime       (WS subscribe/dispatch, presence panels, field-level merge planning,
 *                   collaboration messages)
 *
 * Behavior modules import concrete functions from the core modules (the `CoreClientSeam`
 * shape documents exactly what is stable), register DOM hydrators through the
 * `HydratorRegistry`, and contribute their public API surface to `window.cfFrappe` via a
 * `NamespaceExtensions` contribution. The core namespace is assembled and frozen once at
 * boot, after every registered module has contributed.
 */

import type {
  BulkDocumentInput,
  CommandOptions,
  FilterableOptions,
  ParamOptions,
  TenantOptions,
  UnknownRecord,
  VersionOptions
} from "./bodies.js";
import type { ContextScriptSource, DeskPageContext } from "./context.js";
import type { RequestOptions } from "./http.js";
import type { RealtimeTopicOptions } from "./topics.js";
import type { QueryParams } from "./url.js";

export type {
  BulkDocumentInput,
  CommandOptions,
  ContextScriptSource,
  DeskPageContext,
  FilterableOptions,
  ParamOptions,
  QueryParams,
  RealtimeTopicOptions,
  RequestOptions,
  TenantOptions,
  UnknownRecord,
  VersionOptions
};

/* ------------------------------ hydrator seam ------------------------------ */

/** A DOM hydrator; invoked through `ready()` once the namespace is installed. */
export type Hydrator = () => void;

export interface HydratorRegistration {
  /** Stable identifier, e.g. "file-upload-forms", "compound-filter-builders". */
  readonly name: string;
  readonly hydrate: Hydrator;
}

export interface HydratorRegistry {
  register(registration: HydratorRegistration): void;
  list(): readonly HydratorRegistration[];
}

/* --------------------------- namespace extensions -------------------------- */

/** Upload machinery contributed by the uploads module; merged into `cfFrappe.files`. */
export interface FilesUploadExtension {
  upload(body: unknown, options?: ParamOptions): Promise<unknown>;
  uploadDirect(body: unknown, options?: ParamOptions): Promise<unknown>;
  uploadMultipart(body: unknown, options?: ParamOptions): Promise<unknown>;
  uploadMultipartPart(name: string, partNumber: number, body: unknown, options?: ParamOptions): Promise<unknown>;
  prepareDirectUpload(input?: UnknownRecord): Promise<unknown>;
  prepareMultipartUpload(input?: UnknownRecord): Promise<unknown>;
  completeDirectUpload(name: string, options?: VersionOptions): Promise<unknown>;
  completeMultipartUpload(name: string, parts: readonly unknown[], options?: VersionOptions): Promise<unknown>;
  abortMultipartUpload(name: string, options?: VersionOptions): Promise<unknown>;
}

/** Form binding + `frm` API contributed by the form module; becomes `cfFrappe.form`. */
export interface FormNamespaceExtension {
  current(): unknown | null;
  on(doctype: string | UnknownRecord, handlers?: UnknownRecord): unknown;
  trigger(eventName: string): unknown;
}

export interface RealtimeSubscribeHandlers {
  [event: string]: unknown;
}

/** Realtime WS API contributed by the realtime module; becomes `cfFrappe.realtime`. */
export interface RealtimeNamespaceExtension {
  connect(topic: string, options?: RealtimeTopicOptions): unknown;
  doctype(doctype: string, options?: RealtimeTopicOptions): unknown;
  doctypeUrl(doctype: string, options?: RealtimeTopicOptions): string;
  document(doctype: string, name: string, options?: RealtimeTopicOptions): unknown;
  documentUrl(doctype: string, name: string, options?: RealtimeTopicOptions): string;
  tenant(options?: RealtimeTopicOptions): unknown;
  tenantUrl(options?: RealtimeTopicOptions): string;
  user(userId?: string, options?: RealtimeTopicOptions): unknown;
  userUrl(userId?: string, options?: RealtimeTopicOptions): string;
  presence(topic: string, options?: RealtimeTopicOptions): unknown;
  presenceDoctype(doctype: string, options?: RealtimeTopicOptions): unknown;
  presenceDocument(doctype: string, name: string, options?: RealtimeTopicOptions): unknown;
  presenceTenant(options?: RealtimeTopicOptions): unknown;
  presenceUrl(topic: string, options?: RealtimeTopicOptions): string;
  presenceUser(userId?: string, options?: RealtimeTopicOptions): unknown;
  subscribe(topic: string, handlers?: RealtimeSubscribeHandlers, options?: RealtimeTopicOptions): unknown;
  subscribeDoctype(doctype: string, handlers?: RealtimeSubscribeHandlers, options?: RealtimeTopicOptions): unknown;
  subscribeDocument(
    doctype: string,
    name: string,
    handlers?: RealtimeSubscribeHandlers,
    options?: RealtimeTopicOptions
  ): unknown;
  subscribeTenant(handlers?: RealtimeSubscribeHandlers, options?: RealtimeTopicOptions): unknown;
  subscribeUser(userId?: string, handlers?: RealtimeSubscribeHandlers, options?: RealtimeTopicOptions): unknown;
  url(topic: string, options?: RealtimeTopicOptions): string;
}

/** Collaboration/merge-planning API; becomes `cfFrappe.collaboration`. */
export interface CollaborationNamespaceExtension {
  fieldEditMessage(field: string, input?: UnknownRecord): unknown;
  mergePlan(local: UnknownRecord, base: UnknownRecord, remote: UnknownRecord, options?: UnknownRecord): unknown;
  sendFieldEdit(subscription: unknown, field: string, input?: UnknownRecord): unknown;
  sendSharedDraft(subscription: unknown, input?: UnknownRecord): unknown;
  sharedDraftMessage(input?: UnknownRecord): unknown;
}

/**
 * Contributions merged into the frozen `window.cfFrappe` namespace at boot.
 * `files` is merged over the core files API; the other groups are added verbatim.
 */
export interface NamespaceExtensions {
  files?: Partial<FilesUploadExtension> & UnknownRecord;
  form?: FormNamespaceExtension;
  realtime?: RealtimeNamespaceExtension;
  collaboration?: CollaborationNamespaceExtension;
}

export type NamespaceContribution = (core: CoreClientSeam) => NamespaceExtensions;

/* ------------------------------- core seam --------------------------------- */

/**
 * The stable core surface behavior modules may rely on. Implemented by the core
 * modules and exported as a single `coreSeam` object from `namespace.ts` (also
 * exposed for tests). Signatures here are the compatibility contract for the
 * parallel porting agents — do not change them without coordinating.
 */
export interface CoreClientSeam {
  /* constants */
  readonly childRowIndexField: string;
  readonly minMultipartChunkBytes: number;
  readonly maxMultipartFileParts: number;
  readonly lockedValueProperty: string;
  readonly readOnlyProperty: string;
  readonly softDisabledProperty: string;
  readonly realtimeCollaborationMessageType: string;
  readonly fieldEditMessageType: string;
  readonly sharedDraftMessageType: string;

  /* context */
  pageContext(script?: ContextScriptSource | null): DeskPageContext;
  runtimeScript(): ContextScriptSource | null;
  ready(callback: () => void): void;

  /* http */
  request(path: string, options?: RequestOptions): Promise<unknown>;
  requestBinary(path: string, options?: RequestOptions): Promise<ArrayBuffer>;
  readResponsePayload(response: Response): Promise<unknown>;
  throwResponseError(response: Response, payload: unknown): never;
  unwrapData(payload: unknown): unknown;
  withQuery(path: string, params?: QueryParams): string;
  encodePart(value: unknown): string;
  encodePath(value: unknown): string;
  resourcePath(doctype: string, name?: string): string;
  resourceActionPath(doctype: string, name: string, action: string): string;
  deskPath(doctype: string): string;
  filePath(name: string, action?: string): string;

  /* bodies */
  versionBody(options?: VersionOptions): UnknownRecord;
  commandBody(input: UnknownRecord | undefined, options?: VersionOptions): UnknownRecord;
  fileAttachmentParams(params: UnknownRecord, options?: ParamOptions): void;
  fileListParams(options?: ParamOptions): QueryParams;
  resourceListParams(options?: FilterableOptions): QueryParams;
  reportRunParams(options?: FilterableOptions): QueryParams;

  /* topics */
  documentTopic(tenantId: string, doctype: string, name: string): string;
  doctypeTopic(tenantId: string, doctype: string): string;
  tenantTopic(tenantId: string): string;
  userTopic(tenantId: string, userId: string): string;
  doctypeTopicFromOptions(doctype: string, options?: RealtimeTopicOptions): string;
  documentTopicFromOptions(doctype: string, name: string, options?: RealtimeTopicOptions): string;
  tenantTopicFromOptions(options?: RealtimeTopicOptions): string;
  userTopicFromOptions(userId?: string, options?: RealtimeTopicOptions): string;

  /* ui */
  msgprint(message: unknown): string;
}

export type BulkDocuments = readonly BulkDocumentInput[];
