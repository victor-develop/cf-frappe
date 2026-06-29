export function isDocumentConflictError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "DOCUMENT_CONFLICT";
}
