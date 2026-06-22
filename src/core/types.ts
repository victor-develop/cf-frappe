export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonArray = readonly JsonValue[];
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export type MutableDocumentData = Record<string, JsonValue | undefined>;
export type DocumentData = Record<string, JsonValue>;

export type TenantId = string;
export type DocumentName = string;
export type DocTypeName = string;
export type StreamName = string;

export type FieldType =
  | "text"
  | "longText"
  | "integer"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "json"
  | "select"
  | "link"
  | "table";

export interface FieldDefaultContext {
  readonly actor: Actor;
  readonly now: string;
}

export interface FieldDefinition {
  readonly name: string;
  readonly label?: string;
  readonly type: FieldType;
  readonly required?: boolean;
  readonly readOnly?: boolean;
  readonly hidden?: boolean;
  readonly inFormView?: boolean;
  readonly inListView?: boolean;
  readonly inListFilter?: boolean;
  readonly options?: readonly string[];
  readonly linkTo?: DocTypeName;
  readonly tableOf?: DocTypeName;
  readonly min?: number;
  readonly max?: number;
  readonly defaultValue?: JsonValue | ((context: FieldDefaultContext) => JsonValue);
}

export type PermissionAction =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "submit"
  | "cancel"
  | "transition"
  | "comment"
  | "assign"
  | "activity"
  | "tag"
  | "follow";

export interface Actor {
  readonly id: string;
  readonly roles: readonly string[];
  readonly tenantId?: TenantId;
  readonly email?: string;
}

export type PermissionPredicate = (context: PermissionContext) => boolean;

export interface PermissionContext {
  readonly actor: Actor;
  readonly action: PermissionAction;
  readonly doctype: DocTypeDefinition;
  readonly document?: DocumentSnapshot;
}

export interface PermissionRule {
  readonly roles: readonly string[];
  readonly actions: readonly PermissionAction[];
  readonly when?: PermissionPredicate;
}

export type DocStatus = "draft" | "submitted" | "cancelled" | "deleted";

export interface WorkflowTransition {
  readonly action: string;
  readonly from: string;
  readonly to: string;
  readonly roles?: readonly string[];
  readonly eventType?: string;
}

export interface WorkflowDefinition {
  readonly stateField?: string;
  readonly initialState: string;
  readonly states: readonly string[];
  readonly transitions: readonly WorkflowTransition[];
}

export interface DomainCommandContext {
  readonly actor: Actor;
  readonly document: DocumentSnapshot;
  readonly input: DocumentData;
  readonly now: string;
}

export interface DomainCommandDefinition {
  readonly name: string;
  readonly eventType: string;
  readonly fields?: readonly string[];
  readonly roles?: readonly string[];
  readonly permissionAction?: PermissionAction;
  readonly buildPatch?: (context: DomainCommandContext) => DocumentData;
}

export type NamingStrategy =
  | { readonly kind: "uuid" }
  | { readonly kind: "field"; readonly field: string }
  | { readonly kind: "provided"; readonly field?: string }
  | { readonly kind: "series"; readonly pattern: string };

export interface DocTypeDefinition<TData extends DocumentData = DocumentData> {
  readonly name: DocTypeName;
  readonly module?: string;
  readonly version?: number;
  readonly label?: string;
  readonly fields: readonly FieldDefinition[];
  readonly formView?: FormViewDefinition;
  readonly listView?: ListViewDefinition;
  readonly permissions?: readonly PermissionRule[];
  readonly workflow?: WorkflowDefinition;
  readonly commands?: readonly DomainCommandDefinition[];
  readonly naming?: NamingStrategy;
  readonly allowUnknownFields?: boolean;
  readonly indexes?: readonly (readonly string[])[];
  readonly events?: {
    readonly create?: string;
    readonly update?: string;
    readonly submit?: string;
    readonly cancel?: string;
    readonly delete?: string;
    readonly comment?: string;
    readonly assign?: string;
    readonly unassign?: string;
    readonly activity?: string;
    readonly tag?: string;
    readonly untag?: string;
    readonly follow?: string;
    readonly unfollow?: string;
  };
  readonly description?: string;
  readonly __data?: TData;
}

export interface ValidationIssue {
  readonly field?: string;
  readonly code: string;
  readonly message: string;
}

export interface DocumentSnapshot<TData extends DocumentData = DocumentData> {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly name: DocumentName;
  readonly version: number;
  readonly docstatus: DocStatus;
  readonly data: TData;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type DocumentEventPayload =
  | {
      readonly kind: "DocumentCreated";
      readonly data: DocumentData;
      readonly docstatus: DocStatus;
    }
  | {
      readonly kind: "DocumentUpdated";
      readonly patch: DocumentData;
    }
  | {
      readonly kind: "DocumentDeleted";
    }
  | {
      readonly kind: "DocumentSubmitted";
    }
  | {
      readonly kind: "DocumentCancelled";
    }
  | {
      readonly kind: "DocumentCommentAdded";
      readonly text: string;
    }
  | {
      readonly kind: "DocumentActivityRecorded";
      readonly activityType: string;
      readonly subject: string;
      readonly detail?: string;
      readonly channel?: string;
      readonly externalId?: string;
    }
  | {
      readonly kind: "DocumentAssigned";
      readonly assigneeId: string;
    }
  | {
      readonly kind: "DocumentUnassigned";
      readonly assigneeId: string;
    }
  | {
      readonly kind: "DocumentTagged";
      readonly tag: string;
    }
  | {
      readonly kind: "DocumentUntagged";
      readonly tag: string;
    }
  | {
      readonly kind: "DocumentFollowed";
      readonly followerId: string;
    }
  | {
      readonly kind: "DocumentUnfollowed";
      readonly followerId: string;
    }
  | {
      readonly kind: "UserPermissionAllowed";
      readonly userId: string;
      readonly targetDoctype: DocTypeName;
      readonly targetName: DocumentName;
      readonly applicableDoctypes?: readonly DocTypeName[];
    }
  | {
      readonly kind: "UserPermissionRevoked";
      readonly userId: string;
      readonly targetDoctype: DocTypeName;
      readonly targetName: DocumentName;
      readonly applicableDoctypes?: readonly DocTypeName[];
    }
  | {
      readonly kind: "UserAccountCreated";
      readonly userId: string;
      readonly email?: string;
      readonly roles: readonly string[];
      readonly passwordHash: string;
      readonly enabled: boolean;
    }
  | {
      readonly kind: "UserPasswordChanged";
      readonly userId: string;
      readonly passwordHash: string;
    }
  | {
      readonly kind: "UserPasswordResetRequested";
      readonly userId: string;
      readonly tokenHash: string;
      readonly expiresAt: string;
    }
  | {
      readonly kind: "UserPasswordResetCompleted";
      readonly userId: string;
      readonly passwordHash: string;
    }
  | {
      readonly kind: "UserPasswordResetDeliveryFailed";
      readonly userId: string;
    }
  | {
      readonly kind: "UserEmailVerificationRequested";
      readonly userId: string;
      readonly email: string;
      readonly tokenHash: string;
      readonly expiresAt: string;
    }
  | {
      readonly kind: "UserEmailVerified";
      readonly userId: string;
      readonly email: string;
    }
  | {
      readonly kind: "UserEmailVerificationDeliveryFailed";
      readonly userId: string;
      readonly email: string;
    }
  | {
      readonly kind: "UserRolesChanged";
      readonly userId: string;
      readonly roles: readonly string[];
    }
  | {
      readonly kind: "UserAccountEnabled";
      readonly userId: string;
    }
  | {
      readonly kind: "UserAccountDisabled";
      readonly userId: string;
    }
  | {
      readonly kind: "RoleCreated";
      readonly role: string;
      readonly enabled: boolean;
      readonly description?: string;
    }
  | {
      readonly kind: "RoleDescriptionChanged";
      readonly role: string;
      readonly description?: string;
    }
  | {
      readonly kind: "RoleEnabled";
      readonly role: string;
    }
  | {
      readonly kind: "RoleDisabled";
      readonly role: string;
    }
  | {
      readonly kind: "SavedListFilterSaved";
      readonly filterId: string;
      readonly label: string;
      readonly ownerId: string;
      readonly filters: readonly ListDocumentsFilter[];
    }
  | {
      readonly kind: "SavedListFilterDeleted";
      readonly filterId: string;
      readonly ownerId: string;
    }
  | {
      readonly kind: "SavedReportSaved";
      readonly reportId: string;
      readonly label: string;
      readonly ownerId: string;
      readonly definition: JsonObject;
    }
  | {
      readonly kind: "SavedReportDeleted";
      readonly reportId: string;
      readonly ownerId: string;
    }
  | {
      readonly kind: "WorkflowTransitioned";
      readonly action: string;
      readonly from: string;
      readonly to: string;
      readonly patch: DocumentData;
    }
  | {
      readonly kind: "DomainCommandApplied";
      readonly command: string;
      readonly input: DocumentData;
      readonly patch: DocumentData;
    };

export interface DomainEvent<TPayload extends DocumentEventPayload = DocumentEventPayload> {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly stream: StreamName;
  readonly sequence: number;
  readonly type: string;
  readonly doctype: DocTypeName;
  readonly documentName: DocumentName;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly payload: TPayload;
  readonly metadata: DocumentData;
}

export type NewDomainEvent<TPayload extends DocumentEventPayload = DocumentEventPayload> =
  Omit<DomainEvent<TPayload>, "sequence">;

export type ListFilterOperator = "eq" | "ne" | "contains" | "gt" | "gte" | "lt" | "lte";
export type ListFilterInputType = "text" | "number" | "date" | "datetime-local" | "select" | "boolean";

export interface ListDocumentsFilter {
  readonly field: string;
  readonly operator?: ListFilterOperator;
  readonly value: JsonPrimitive;
}

export interface ListFilterOperatorOption {
  readonly operator: ListFilterOperator;
  readonly label: string;
}

export interface ListFilterControlDefinition {
  readonly field: string;
  readonly operator: ListFilterOperator;
  readonly operatorLabel: string;
  readonly inputType: ListFilterInputType;
  readonly queryKey: string;
  readonly labelSuffix?: string;
}

export interface ListFilterBuilderField {
  readonly field: string;
  readonly inputType: ListFilterInputType;
  readonly operators: readonly ListFilterOperatorOption[];
}

export interface FormSectionDefinition {
  readonly heading?: string;
  readonly fields: readonly string[];
  readonly columns?: 1 | 2;
}

export interface FormViewDefinition {
  readonly sections?: readonly FormSectionDefinition[];
}

export interface ResolvedFormSection {
  readonly heading?: string;
  readonly fields: readonly FieldDefinition[];
  readonly columns: 1 | 2;
}

export interface ResolvedFormView {
  readonly sections: readonly ResolvedFormSection[];
  readonly fields: readonly FieldDefinition[];
}

export interface ListViewDefinition {
  readonly columns?: readonly string[];
  readonly filterFields?: readonly string[];
  readonly filters?: readonly ListDocumentsFilter[];
  readonly pageSize?: number;
}

export interface ResolvedListView {
  readonly columns: readonly FieldDefinition[];
  readonly filterFields: readonly FieldDefinition[];
  readonly filterBuilderFields: readonly ListFilterBuilderField[];
  readonly filterControls: readonly ListFilterControlDefinition[];
  readonly filters: readonly ListDocumentsFilter[];
  readonly pageSize: number;
}

export interface ListDocumentsQuery {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly filters?: readonly ListDocumentsFilter[];
  readonly limit?: number;
  readonly offset?: number;
}

export interface ListDocumentsResult<TData extends DocumentData = DocumentData> {
  readonly data: readonly DocumentSnapshot<TData>[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
}

export interface LinkOption {
  readonly value: DocumentName;
  readonly label: string;
}

export interface LinkOptionsResult {
  readonly doctype: DocTypeName;
  readonly field: string;
  readonly target: DocTypeName;
  readonly options: readonly LinkOption[];
}

export const CHILD_TABLE_ROW_INDEX_FIELD = "__cf_frappe_row_index";
export const SYSTEM_MANAGER_ROLE = "System Manager";
export const DEFAULT_TENANT_ID = "default";
