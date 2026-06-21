import { FrameworkError } from "./errors";
import type { PrintFormatDefinition } from "./print-format";
import { assertPrintFormatMatchesDocType } from "./print-format";
import type { ReportDefinition } from "./reports";
import { assertReportMatchesDocType } from "./reports";
import type {
  DocTypeDefinition,
  DocumentData,
  DocumentSnapshot,
  DomainEvent,
  MutableDocumentData,
  ValidationIssue
} from "./types";

export type MaybePromise<T> = T | Promise<T>;

export interface HookContext {
  readonly doctype: DocTypeDefinition;
  readonly data: DocumentData;
  readonly existing?: DocumentSnapshot;
}

export interface AfterCommitContext extends HookContext {
  readonly event: DomainEvent;
  readonly snapshot: DocumentSnapshot | null;
}

export interface DocumentHooks {
  readonly beforeValidate?: (context: HookContext) => MaybePromise<MutableDocumentData | void>;
  readonly validate?: (context: HookContext) => MaybePromise<readonly ValidationIssue[] | void>;
  readonly afterCommit?: (context: AfterCommitContext) => MaybePromise<void>;
}

export interface RegistryOptions {
  readonly doctypes?: readonly DocTypeDefinition[];
  readonly printFormats?: readonly PrintFormatDefinition[];
  readonly reports?: readonly ReportDefinition[];
  readonly hooks?: Readonly<Record<string, readonly DocumentHooks[]>>;
}

export class ModelRegistry {
  private readonly doctypes = new Map<string, DocTypeDefinition>();
  private readonly printFormats = new Map<string, PrintFormatDefinition>();
  private readonly reports = new Map<string, ReportDefinition>();
  private readonly hooks = new Map<string, DocumentHooks[]>();

  constructor(options: RegistryOptions = {}) {
    for (const doctype of options.doctypes ?? []) {
      this.putDocType(doctype);
    }
    this.assertDocTypeLinksResolve();
    for (const report of options.reports ?? []) {
      this.registerReport(report);
    }
    for (const format of options.printFormats ?? []) {
      this.registerPrintFormat(format);
    }
    for (const [doctype, hooks] of Object.entries(options.hooks ?? {})) {
      for (const hook of hooks) {
        this.registerHooks(doctype, hook);
      }
    }
  }

  registerDocType(doctype: DocTypeDefinition): void {
    this.putDocType(doctype);
    try {
      this.assertDocTypeLinksResolve();
    } catch (error) {
      this.doctypes.delete(doctype.name);
      throw error;
    }
  }

  private putDocType(doctype: DocTypeDefinition): void {
    if (this.doctypes.has(doctype.name)) {
      throw new FrameworkError("DOCTYPE_DUPLICATE", `DocType '${doctype.name}' is already registered`, {
        status: 409
      });
    }
    this.doctypes.set(doctype.name, doctype);
  }

  private assertDocTypeLinksResolve(): void {
    for (const doctype of this.doctypes.values()) {
      for (const field of doctype.fields) {
        if (field.type !== "link") {
          continue;
        }
        const target = field.linkTo;
        if (!target || !this.doctypes.has(target)) {
          throw new FrameworkError(
            "DOCTYPE_LINK_INVALID",
            `Link field '${field.name}' on ${doctype.name} targets unregistered DocType '${target ?? ""}'`,
            { status: 400 }
          );
        }
      }
    }
  }

  registerReport(report: ReportDefinition): void {
    const doctype = this.doctypes.get(report.doctype);
    if (!doctype) {
      throw new FrameworkError("DOCTYPE_NOT_FOUND", `DocType '${report.doctype}' is not registered`, {
        status: 404
      });
    }
    if (this.reports.has(report.name)) {
      throw new FrameworkError("REPORT_DUPLICATE", `Report '${report.name}' is already registered`, {
        status: 409
      });
    }
    assertReportMatchesDocType(report, doctype);
    this.reports.set(report.name, report);
  }

  registerPrintFormat(format: PrintFormatDefinition): void {
    const doctype = this.doctypes.get(format.doctype);
    if (!doctype) {
      throw new FrameworkError("DOCTYPE_NOT_FOUND", `DocType '${format.doctype}' is not registered`, {
        status: 404
      });
    }
    if (this.printFormats.has(format.name)) {
      throw new FrameworkError("PRINT_FORMAT_DUPLICATE", `Print format '${format.name}' is already registered`, {
        status: 409
      });
    }
    assertPrintFormatMatchesDocType(format, doctype);
    this.printFormats.set(format.name, format);
  }

  registerHooks(doctype: string, hooks: DocumentHooks): void {
    this.hooks.set(doctype, [...(this.hooks.get(doctype) ?? []), hooks]);
  }

  get(doctype: string): DocTypeDefinition {
    const definition = this.doctypes.get(doctype);
    if (!definition) {
      throw new FrameworkError("DOCTYPE_NOT_FOUND", `DocType '${doctype}' is not registered`, {
        status: 404
      });
    }
    return definition;
  }

  has(doctype: string): boolean {
    return this.doctypes.has(doctype);
  }

  list(): readonly DocTypeDefinition[] {
    return [...this.doctypes.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  getReport(reportName: string): ReportDefinition {
    const definition = this.reports.get(reportName);
    if (!definition) {
      throw new FrameworkError("REPORT_NOT_FOUND", `Report '${reportName}' is not registered`, {
        status: 404
      });
    }
    return definition;
  }

  listReports(): readonly ReportDefinition[] {
    return [...this.reports.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  getPrintFormat(formatName: string): PrintFormatDefinition {
    const definition = this.printFormats.get(formatName);
    if (!definition) {
      throw new FrameworkError("PRINT_FORMAT_NOT_FOUND", `Print format '${formatName}' is not registered`, {
        status: 404
      });
    }
    return definition;
  }

  listPrintFormats(): readonly PrintFormatDefinition[] {
    return [...this.printFormats.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  hooksFor(doctype: string): readonly DocumentHooks[] {
    return this.hooks.get(doctype) ?? [];
  }
}

export function createRegistry(options: RegistryOptions = {}): ModelRegistry {
  return new ModelRegistry(options);
}
