/**
 * The two identifier shapes the framework validates, kept apart on purpose.
 *
 * Metadata names are author-facing: DocType names, field names, report and print
 * format names. They allow spaces, because `"customer id"` is a legitimate field
 * name.
 *
 * Plain identifiers are machine-facing: SQL identifiers and environment variable
 * names. They allow no spaces, and are the guard on values that get interpolated
 * into SQL or read from the environment. Do not widen this to accept what a
 * metadata name accepts.
 */

const METADATA_NAME = /^[A-Za-z][A-Za-z0-9_ ]*$/;
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** An author-facing metadata name: letters, digits, underscores and spaces. */
export function isMetadataName(value: string): boolean {
  return METADATA_NAME.test(value);
}

/** A machine-facing identifier: letters, digits and underscores, no spaces. */
export function isPlainIdentifier(value: string): boolean {
  return PLAIN_IDENTIFIER.test(value);
}
