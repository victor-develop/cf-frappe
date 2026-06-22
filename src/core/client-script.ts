import { FrameworkError } from "./errors";

export type ClientScriptScope = "form" | "list" | "both";
export type ClientScriptType = "module" | "classic";

export interface ClientScriptDefinition {
  readonly name: string;
  readonly doctype: string;
  readonly src: string;
  readonly scope?: ClientScriptScope;
  readonly type?: ClientScriptType;
  readonly label?: string;
  readonly module?: string;
  readonly description?: string;
}

export function defineClientScript(input: ClientScriptDefinition): ClientScriptDefinition {
  const script = normalizeClientScript(input);
  assertClientScriptValid(script);
  return Object.freeze(script);
}

export function assertClientScriptValid(script: ClientScriptDefinition): void {
  assertNonEmpty(script.name, "Client script name");
  assertNonEmpty(script.doctype, `Client script '${script.name}' DocType`);
  assertClientScriptSrc(script);
  if (script.scope !== undefined && script.scope !== "form" && script.scope !== "list" && script.scope !== "both") {
    throw new FrameworkError(
      "CLIENT_SCRIPT_INVALID",
      `Client script '${script.name}' scope must be form, list, or both`,
      { status: 400 }
    );
  }
  if (script.type !== undefined && script.type !== "module" && script.type !== "classic") {
    throw new FrameworkError(
      "CLIENT_SCRIPT_INVALID",
      `Client script '${script.name}' type must be module or classic`,
      { status: 400 }
    );
  }
}

export function clientScriptAppliesTo(script: ClientScriptDefinition, scope: Exclude<ClientScriptScope, "both">): boolean {
  return (script.scope ?? "form") === scope || script.scope === "both";
}

function assertClientScriptSrc(script: ClientScriptDefinition): void {
  const src = script.src;
  if (
    src.length === 0 ||
    !src.startsWith("/") ||
    src.startsWith("//") ||
    src.includes("\\") ||
    /[\u0000-\u001f]/.test(src)
  ) {
    throw new FrameworkError(
      "CLIENT_SCRIPT_INVALID",
      `Client script '${script.name}' src must be a same-origin absolute path`,
      { status: 400 }
    );
  }
}

function normalizeClientScript(script: ClientScriptDefinition): ClientScriptDefinition {
  return {
    ...script,
    name: script.name.trim(),
    doctype: script.doctype.trim(),
    src: script.src.trim()
  };
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new FrameworkError("CLIENT_SCRIPT_INVALID", `${label} is required`, { status: 400 });
  }
}
