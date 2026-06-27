import { FrameworkError } from "./errors.js";
import { SYSTEM_MANAGER_ROLE, type Actor } from "./types.js";

export type WorkspaceShortcutKind =
  | "doctype"
  | "newDoc"
  | "report"
  | "dashboard"
  | "kanban"
  | "file"
  | "notifications"
  | "admin"
  | "url";

export interface WorkspaceShortcutDefinition {
  readonly name: string;
  readonly label?: string;
  readonly description?: string;
  readonly kind: WorkspaceShortcutKind;
  readonly target?: string;
  readonly href?: string;
  readonly roles?: readonly string[];
}

export interface WorkspaceSectionDefinition {
  readonly name: string;
  readonly label?: string;
  readonly shortcuts: readonly WorkspaceShortcutDefinition[];
}

export interface WorkspaceDefinition {
  readonly name: string;
  readonly label?: string;
  readonly module?: string;
  readonly description?: string;
  readonly roles?: readonly string[];
  readonly sections: readonly WorkspaceSectionDefinition[];
}

const WORKSPACE_SHORTCUT_KINDS = [
  "doctype",
  "newDoc",
  "report",
  "dashboard",
  "kanban",
  "file",
  "notifications",
  "admin",
  "url"
] as const;

export function defineWorkspace(definition: WorkspaceDefinition): WorkspaceDefinition {
  assertWorkspaceDefinition(definition);
  return Object.freeze({
    ...definition,
    ...(definition.roles ? { roles: Object.freeze([...definition.roles]) } : {}),
    sections: Object.freeze(
      definition.sections.map((section) =>
        Object.freeze({
          ...section,
          shortcuts: Object.freeze(
            section.shortcuts.map((shortcut) =>
              Object.freeze({
                ...shortcut,
                ...(shortcut.roles ? { roles: Object.freeze([...shortcut.roles]) } : {})
              })
            )
          )
        })
      )
    )
  });
}

export function assertWorkspaceDefinition(definition: WorkspaceDefinition): void {
  assertWorkspaceIdentifier(definition.name, "workspace name");
  assertUnique(definition.sections.map((section) => section.name), "section", definition.name);
  const shortcutNames = new Set<string>();
  for (const section of definition.sections) {
    assertWorkspaceIdentifier(section.name, "workspace section name");
    if (section.shortcuts.length === 0) {
      throw new FrameworkError(
        "WORKSPACE_INVALID",
        `Workspace '${definition.name}' section '${section.name}' must define at least one shortcut`,
        { status: 400 }
      );
    }
    for (const shortcut of section.shortcuts) {
      assertWorkspaceIdentifier(shortcut.name, "workspace shortcut name");
      if (shortcutNames.has(shortcut.name)) {
        throw new FrameworkError(
          "WORKSPACE_INVALID",
          `Workspace '${definition.name}' has duplicate shortcut '${shortcut.name}'`,
          { status: 400 }
        );
      }
      shortcutNames.add(shortcut.name);
      assertWorkspaceShortcut(shortcut, definition.name);
    }
  }
}

export function canReadWorkspace(actor: Actor, workspace: WorkspaceDefinition): boolean {
  return canReadByRoles(actor, workspace.roles);
}

export function canReadWorkspaceShortcut(actor: Actor, shortcut: WorkspaceShortcutDefinition): boolean {
  return canReadByRoles(actor, shortcut.roles);
}

function canReadByRoles(actor: Actor, roles: readonly string[] | undefined): boolean {
  if (actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return true;
  }
  return roles === undefined || roles.some((role) => actor.roles.includes(role));
}

function assertWorkspaceShortcut(shortcut: WorkspaceShortcutDefinition, workspaceName: string): void {
  if (!WORKSPACE_SHORTCUT_KINDS.includes(shortcut.kind)) {
    throw new FrameworkError(
      "WORKSPACE_INVALID",
      `Workspace '${workspaceName}' shortcut '${shortcut.name}' has invalid kind '${String(shortcut.kind)}'`,
      { status: 400 }
    );
  }
  if (shortcut.kind === "url") {
    if (!shortcut.href || !isSafeWorkspaceHref(shortcut.href)) {
      throw new FrameworkError(
        "WORKSPACE_INVALID",
        `Workspace '${workspaceName}' shortcut '${shortcut.name}' must define a safe href`,
        { status: 400 }
      );
    }
    return;
  }
  if (shortcut.href !== undefined) {
    throw new FrameworkError(
      "WORKSPACE_INVALID",
      `Workspace '${workspaceName}' shortcut '${shortcut.name}' can only define href for url shortcuts`,
      { status: 400 }
    );
  }
  if (shortcut.kind === "file" || shortcut.kind === "notifications") {
    if (shortcut.target !== undefined) {
      throw new FrameworkError(
        "WORKSPACE_INVALID",
        `Workspace '${workspaceName}' shortcut '${shortcut.name}' must not define a target`,
        { status: 400 }
      );
    }
    return;
  }
  if (!shortcut.target?.trim()) {
    throw new FrameworkError(
      "WORKSPACE_INVALID",
      `Workspace '${workspaceName}' shortcut '${shortcut.name}' must define a target`,
      { status: 400 }
    );
  }
}

function assertWorkspaceIdentifier(value: string, label: string): void {
  if (!value.trim()) {
    throw new FrameworkError("WORKSPACE_INVALID", `${label} is required`, { status: 400 });
  }
}

function assertUnique(values: readonly string[], label: string, workspaceName: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new FrameworkError(
        "WORKSPACE_INVALID",
        `Workspace '${workspaceName}' has duplicate ${label} '${value}'`,
        { status: 400 }
      );
    }
    seen.add(value);
  }
}

function isSafeWorkspaceHref(value: string): boolean {
  if (value.startsWith("/")) {
    return !value.startsWith("//") && !value.startsWith("/\\");
  }
  if (!value.startsWith("https://") && !value.startsWith("http://")) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
