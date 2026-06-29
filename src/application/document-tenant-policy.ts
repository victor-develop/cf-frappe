import {
  DEFAULT_TENANT_ID,
  type Actor,
  type DocTypeDefinition
} from "../core/types.js";
import {
  relatedDocTypeNames,
  type RelatedDocTypeResolver
} from "./document-reference-policy.js";

export interface TenantDocTypeResolutionContext {
  readonly actor: Actor;
  readonly tenantId: string;
}

export type TenantDocTypeResolver = (
  base: DocTypeDefinition,
  context: TenantDocTypeResolutionContext
) => DocTypeDefinition | Promise<DocTypeDefinition>;

export interface ResolvedTenantDocTypeContext {
  readonly doctype: DocTypeDefinition;
  readonly relatedDocType: RelatedDocTypeResolver;
}

export function resolveTenant(actor: Actor, explicitTenantId?: string): string {
  return explicitTenantId ?? actor.tenantId ?? DEFAULT_TENANT_ID;
}

export async function resolveTenantDocType(
  base: DocTypeDefinition,
  context: TenantDocTypeResolutionContext,
  resolver?: TenantDocTypeResolver
): Promise<DocTypeDefinition> {
  return (await resolver?.(base, context)) ?? base;
}

export async function resolveTenantDocTypeContext(
  root: DocTypeDefinition,
  resolveByName: (name: string) => Promise<DocTypeDefinition>
): Promise<ResolvedTenantDocTypeContext> {
  const related = new Map<string, DocTypeDefinition>();
  related.set(root.name, root);
  await collectReachableDocTypes(root, resolveByName, related);
  return {
    doctype: root,
    relatedDocType: (name) => related.get(name)
  };
}

async function collectReachableDocTypes(
  doctype: DocTypeDefinition,
  resolveByName: (name: string) => Promise<DocTypeDefinition>,
  related: Map<string, DocTypeDefinition>
): Promise<void> {
  for (const name of relatedDocTypeNames(doctype)) {
    if (related.has(name)) {
      continue;
    }
    const resolved = await resolveByName(name);
    related.set(name, resolved);
    await collectReachableDocTypes(resolved, resolveByName, related);
  }
}
