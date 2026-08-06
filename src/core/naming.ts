import { FrameworkError } from "./errors.js";
import { compileSafeRegex, matchesSafeRegex, type SafeRegex } from "./safe-regex.js";
import type {
  DocTypeDefinition,
  DocumentData,
  JsonPrimitive,
  NamingSeriesExclusion,
  NamingSeriesReset,
  NamingSeriesStrategy,
  NamingStrategy,
  TenantId
} from "./types.js";

const MAX_PATTERN_LENGTH = 256;
const MAX_PATTERN_TOKENS = 32;
const MAX_IDENTIFIER_LENGTH = 255;
const MAX_FIELD_TOKEN_LENGTH = 128;
const MAX_COUNTER_LENGTH = 64;
const MAX_EXCLUSIONS = 100;
const MAX_EXCLUSION_TEXT_LENGTH = 255;
const MAX_PADDING = 18;
export const DEFAULT_NAMING_MAX_ATTEMPTS = 10_000;

export type NamingPatternToken =
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "sequence"; readonly width?: number }
  | { readonly kind: "date"; readonly value: "YYYY" | "YY" | "MM" | "DD" | "DDD" | "WW" }
  | { readonly kind: "tenant" }
  | { readonly kind: "doctype" }
  | { readonly kind: "field"; readonly field: string };

export interface CompiledNamingPattern {
  readonly tokens: readonly NamingPatternToken[];
}

export interface NamingRenderContext {
  readonly tenantId: TenantId;
  readonly now: string;
}

export interface NamingSeriesIdentity {
  readonly counter: string;
  readonly scope: string;
  readonly documentName: string;
}

export interface NamingCandidate {
  readonly value: number;
  readonly name: string;
}

export interface NamingCandidateScan {
  readonly candidates: readonly NamingCandidate[];
  readonly attempts: number;
}

export function normalizeNamingStrategy(
  doctype: DocTypeDefinition,
  strategy: NamingStrategy
): NamingStrategy {
  if (strategy.kind !== "series") {
    return Object.freeze({ ...strategy });
  }
  const normalized = Object.freeze({
    kind: "series" as const,
    pattern: requiredText(strategy.pattern, "Naming pattern", MAX_PATTERN_LENGTH),
    ...optionalText(strategy.targetField, "Naming target field", MAX_FIELD_TOKEN_LENGTH, "targetField"),
    ...optionalText(strategy.counter, "Naming counter", MAX_COUNTER_LENGTH, "counter"),
    ...optionalInteger(strategy.padding, "Naming padding", 1, MAX_PADDING, "padding"),
    ...optionalInteger(strategy.start, "Naming start", 1, Number.MAX_SAFE_INTEGER, "start"),
    ...optionalInteger(strategy.step, "Naming step", 1, Number.MAX_SAFE_INTEGER, "step"),
    ...(strategy.reset === undefined ? {} : { reset: normalizeReset(strategy.reset) }),
    ...(strategy.scopeFields === undefined
      ? {}
      : { scopeFields: Object.freeze(uniqueStrings(strategy.scopeFields, "Naming scope field", MAX_FIELD_TOKEN_LENGTH)) }),
    ...(strategy.exclusions === undefined
      ? {}
      : { exclusions: Object.freeze(normalizeExclusions(strategy.exclusions)) }),
    ...optionalInteger(strategy.maxAttempts, "Naming max attempts", 1, DEFAULT_NAMING_MAX_ATTEMPTS, "maxAttempts")
  } satisfies NamingSeriesStrategy);
  assertSeriesDefinition(doctype, normalized);
  return normalized;
}

export function assertNamingStrategyDefinition(doctype: DocTypeDefinition): void {
  if (doctype.naming !== undefined) {
    normalizeNamingStrategy(doctype, doctype.naming);
  }
}

export function compileNamingPattern(
  doctype: DocTypeDefinition,
  strategy: NamingSeriesStrategy
): CompiledNamingPattern {
  const tokens: NamingPatternToken[] = [];
  let literal = "";
  let index = 0;
  const flushLiteral = () => {
    if (literal.length > 0) {
      tokens.push(Object.freeze({ kind: "literal", value: literal }));
      literal = "";
    }
  };
  while (index < strategy.pattern.length) {
    const character = strategy.pattern[index]!;
    if (character === "#") {
      flushLiteral();
      let end = index + 1;
      while (strategy.pattern[end] === "#") {
        end += 1;
      }
      const width = end - index;
      if (width > MAX_PADDING) {
        invalidNaming(`Naming sequence width cannot exceed ${String(MAX_PADDING)}`);
      }
      tokens.push(Object.freeze({ kind: "sequence", width }));
      index = end;
      continue;
    }
    if (character === "{") {
      flushLiteral();
      const end = strategy.pattern.indexOf("}", index + 1);
      if (end < 0) {
        invalidNaming("Naming pattern contains an unclosed token");
      }
      const value = strategy.pattern.slice(index + 1, end);
      tokens.push(parsePatternToken(doctype, value));
      index = end + 1;
      continue;
    }
    if (character === "}") {
      invalidNaming("Naming pattern contains an unmatched closing brace");
    }
    literal += character;
    index += 1;
  }
  flushLiteral();
  if (tokens.length > MAX_PATTERN_TOKENS) {
    invalidNaming(`Naming pattern cannot contain more than ${String(MAX_PATTERN_TOKENS)} tokens`);
  }
  const sequenceTokens = tokens.filter((token) => token.kind === "sequence");
  if (sequenceTokens.length !== 1) {
    invalidNaming("Naming series must contain exactly one sequence token");
  }
  return Object.freeze({ tokens: Object.freeze(tokens) });
}

export function renderNamingCandidate(
  doctype: DocTypeDefinition,
  strategy: NamingSeriesStrategy,
  data: DocumentData,
  context: NamingRenderContext,
  value: number,
  compiled = compileNamingPattern(doctype, strategy)
): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    invalidNaming("Naming sequence value must be a non-negative safe integer", 409);
  }
  const date = parsedDate(context.now);
  const name = compiled.tokens.map((token) => {
    switch (token.kind) {
      case "literal":
        return token.value;
      case "sequence":
        return String(value).padStart(token.width ?? strategy.padding ?? 4, "0");
      case "date":
        return renderDateToken(date, token.value);
      case "tenant":
        return context.tenantId;
      case "doctype":
        return doctype.name;
      case "field":
        return namingFieldValue(data[token.field], token.field);
    }
  }).join("");
  if (name.length === 0 || name.length > MAX_IDENTIFIER_LENGTH || hasUnsafeControlCharacter(name)) {
    invalidNaming(`Generated name must contain 1-${String(MAX_IDENTIFIER_LENGTH)} safe characters`, 409);
  }
  return name;
}

export function resolveNamingSeriesIdentity(
  doctype: DocTypeDefinition,
  strategy: NamingSeriesStrategy,
  data: DocumentData,
  context: NamingRenderContext
): NamingSeriesIdentity {
  const counter = strategy.counter ?? strategy.pattern;
  const parts: string[] = [];
  const reset = strategy.reset ?? "never";
  if (reset !== "never") {
    parts.push(`date=${dateBucket(parsedDate(context.now), reset)}`);
  }
  for (const field of strategy.scopeFields ?? []) {
    parts.push(`${field}=${encodeURIComponent(namingFieldValue(data[field], field))}`);
  }
  const scope = parts.join("|");
  return Object.freeze({
    counter,
    scope,
    documentName: `${doctype.name}:${counter}${scope ? `:${scope}` : ""}`
  });
}

export function nextNamingCandidates(input: {
  readonly doctype: DocTypeDefinition;
  readonly strategy: NamingSeriesStrategy;
  readonly data: DocumentData;
  readonly context: NamingRenderContext;
  readonly current?: number;
  readonly count?: number;
}): readonly NamingCandidate[] {
  return scanNamingCandidates(input).candidates;
}

export function scanNamingCandidates(input: {
  readonly doctype: DocTypeDefinition;
  readonly strategy: NamingSeriesStrategy;
  readonly data: DocumentData;
  readonly context: NamingRenderContext;
  readonly current?: number;
  readonly count?: number;
  readonly attemptLimit?: number;
}): NamingCandidateScan {
  const count = input.count ?? 1;
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
    invalidNaming("Naming preview count must be an integer between 1 and 100");
  }
  const compiled = compileNamingPattern(input.doctype, input.strategy);
  const exclusions = compileExclusions(input.strategy.exclusions ?? []);
  const step = input.strategy.step ?? 1;
  const configuredAttemptLimit = input.strategy.maxAttempts ?? DEFAULT_NAMING_MAX_ATTEMPTS;
  const attemptLimit = input.attemptLimit ?? configuredAttemptLimit;
  if (!Number.isSafeInteger(attemptLimit) || attemptLimit < 1 || attemptLimit > configuredAttemptLimit) {
    invalidNaming(`Naming attempt limit must be an integer between 1 and ${String(configuredAttemptLimit)}`);
  }
  let candidate = input.current === undefined ? input.strategy.start ?? 1 : safeAdd(input.current, step);
  let attempts = 0;
  const result: NamingCandidate[] = [];
  while (result.length < count) {
    attempts += 1;
    if (attempts > attemptLimit) {
      invalidNaming(
        `Naming series for ${input.doctype.name} could not find an allowed value within the configured attempt limit`,
        409
      );
    }
    const name = renderNamingCandidate(
      input.doctype,
      input.strategy,
      input.data,
      input.context,
      candidate,
      compiled
    );
    if (!isExcluded(exclusions, candidate, name)) {
      result.push(Object.freeze({ value: candidate, name }));
    }
    candidate = safeAdd(candidate, step);
  }
  return Object.freeze({ candidates: Object.freeze(result), attempts });
}

export function namingTargetData(
  strategy: NamingSeriesStrategy,
  data: DocumentData,
  name: string
): DocumentData {
  return strategy.targetField === undefined ? data : Object.freeze({ ...data, [strategy.targetField]: name });
}

export function namingSeriesCurrentValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function assertSeriesDefinition(doctype: DocTypeDefinition, strategy: NamingSeriesStrategy): void {
  if (strategy.counter !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(strategy.counter)) {
    invalidNaming("Naming counter may contain only letters, numbers, dot, underscore, and hyphen");
  }
  const targetField = strategy.targetField === undefined
    ? undefined
    : doctype.fields.find((field) => field.name === strategy.targetField);
  if (strategy.targetField !== undefined && targetField === undefined) {
    invalidNaming(`Naming target field '${strategy.targetField}' is not defined on ${doctype.name}`);
  }
  if (targetField !== undefined && targetField.type !== "text") {
    invalidNaming(`Naming target field '${targetField.name}' on ${doctype.name} must be a text field`);
  }
  if (targetField !== undefined && (!targetField.readOnly || !targetField.noCopy)) {
    invalidNaming(
      `Naming target field '${targetField.name}' on ${doctype.name} must be read-only and excluded from copies`
    );
  }
  for (const field of strategy.scopeFields ?? []) {
    const definition = doctype.fields.find((candidate) => candidate.name === field);
    if (definition === undefined) {
      invalidNaming(`Naming scope field '${field}' is not defined on ${doctype.name}`);
    }
    if (definition.type === "table" || definition.type === "json" || definition.type === "longText") {
      invalidNaming(`Naming scope field '${field}' on ${doctype.name} must be a scalar field`);
    }
  }
  const compiled = compileNamingPattern(doctype, strategy);
  assertCounterScopeIsVisible(strategy, compiled);
}

function assertCounterScopeIsVisible(
  strategy: NamingSeriesStrategy,
  compiled: CompiledNamingPattern
): void {
  const fieldTokens = new Set(
    compiled.tokens.flatMap((token) => token.kind === "field" ? [token.field] : [])
  );
  for (const field of strategy.scopeFields ?? []) {
    if (!fieldTokens.has(field)) {
      invalidNaming(`Naming scope field '${field}' must appear in the pattern as '{field:${field}}'`);
    }
  }

  const dateTokens = new Set(
    compiled.tokens.flatMap((token) => token.kind === "date" ? [token.value] : [])
  );
  const reset = strategy.reset ?? "never";
  if (reset === "year" && !dateTokens.has("YYYY")) {
    invalidNaming("Year-reset naming patterns must include '{YYYY}'");
  }
  if (reset === "month" && (!dateTokens.has("YYYY") || !dateTokens.has("MM"))) {
    invalidNaming("Month-reset naming patterns must include '{YYYY}' and '{MM}'");
  }
  if (
    reset === "day" &&
    (
      !dateTokens.has("YYYY") ||
      !(dateTokens.has("DDD") || (dateTokens.has("MM") && dateTokens.has("DD")))
    )
  ) {
    invalidNaming("Day-reset naming patterns must include '{YYYY}' and either '{DDD}' or both '{MM}' and '{DD}'");
  }
}

function parsePatternToken(doctype: DocTypeDefinition, value: string): NamingPatternToken {
  const sequence = /^sequence(?::([1-9]|1[0-8]))?$/.exec(value);
  if (sequence !== null) {
    return Object.freeze({
      kind: "sequence",
      ...(sequence[1] === undefined ? {} : { width: Number(sequence[1]) })
    });
  }
  if (value === "YYYY" || value === "YY" || value === "MM" || value === "DD" || value === "DDD" || value === "WW") {
    return Object.freeze({ kind: "date", value });
  }
  if (value === "tenant" || value === "doctype") {
    return Object.freeze({ kind: value });
  }
  if (value.startsWith("field:")) {
    const field = requiredText(value.slice("field:".length), "Naming field token", MAX_FIELD_TOKEN_LENGTH);
    if (!doctype.fields.some((candidate) => candidate.name === field)) {
      invalidNaming(`Naming field token '${field}' is not defined on ${doctype.name}`);
    }
    return Object.freeze({ kind: "field", field });
  }
  invalidNaming(`Unknown naming token '{${value}}'`);
}

function namingFieldValue(value: JsonPrimitive | readonly unknown[] | DocumentData | undefined, field: string): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    invalidNaming(`Naming field '${field}' must contain a scalar value`, 422);
  }
  const rendered = String(value).trim();
  if (rendered.length === 0 || rendered.length > MAX_FIELD_TOKEN_LENGTH || hasUnsafeControlCharacter(rendered)) {
    invalidNaming(`Naming field '${field}' must contain 1-${String(MAX_FIELD_TOKEN_LENGTH)} safe characters`, 422);
  }
  return rendered;
}

function renderDateToken(date: Date, token: Extract<NamingPatternToken, { readonly kind: "date" }>["value"]): string {
  switch (token) {
    case "YYYY":
      return String(date.getUTCFullYear()).padStart(4, "0");
    case "YY":
      return String(date.getUTCFullYear() % 100).padStart(2, "0");
    case "MM":
      return String(date.getUTCMonth() + 1).padStart(2, "0");
    case "DD":
      return String(date.getUTCDate()).padStart(2, "0");
    case "DDD":
      return String(dayOfYear(date)).padStart(3, "0");
    case "WW":
      return String(isoWeek(date)).padStart(2, "0");
  }
}

function dateBucket(date: Date, reset: Exclude<NamingSeriesReset, "never">): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  if (reset === "year") {
    return year;
  }
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  if (reset === "month") {
    return `${year}-${month}`;
  }
  return `${year}-${month}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86_400_000) + 1;
}

function isoWeek(date: Date): number {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

function parsedDate(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    invalidNaming(`Naming clock value '${value}' is invalid`, 500);
  }
  return date;
}

type CompiledExclusion =
  | Exclude<NamingSeriesExclusion, { readonly type: "regex" }>
  | { readonly type: "regex"; readonly expression: SafeRegex };

function normalizeExclusions(exclusions: readonly NamingSeriesExclusion[]): readonly NamingSeriesExclusion[] {
  if (exclusions.length > MAX_EXCLUSIONS) {
    invalidNaming(`Naming exclusions cannot contain more than ${String(MAX_EXCLUSIONS)} entries`);
  }
  return exclusions.map((exclusion) => {
    switch (exclusion.type) {
      case "range":
        if (!Number.isSafeInteger(exclusion.from) || !Number.isSafeInteger(exclusion.to) || exclusion.from < 0 || exclusion.to < exclusion.from) {
          invalidNaming("Naming exclusion range must contain ordered non-negative safe integers");
        }
        return Object.freeze({ ...exclusion });
      case "regex":
        compileSafeRegex(exclusion.pattern, exclusion.flags);
        return Object.freeze({
          type: "regex" as const,
          pattern: exclusion.pattern,
          ...(exclusion.flags === undefined ? {} : { flags: exclusion.flags })
        });
      default:
        return Object.freeze({
          type: exclusion.type,
          value: requiredText(exclusion.value, `Naming ${exclusion.type} exclusion`, MAX_EXCLUSION_TEXT_LENGTH)
        });
    }
  });
}

function compileExclusions(exclusions: readonly NamingSeriesExclusion[]): readonly CompiledExclusion[] {
  return normalizeExclusions(exclusions).map((exclusion) => exclusion.type === "regex"
    ? Object.freeze({ type: "regex" as const, expression: compileSafeRegex(exclusion.pattern, exclusion.flags) })
    : exclusion);
}

function isExcluded(exclusions: readonly CompiledExclusion[], value: number, name: string): boolean {
  return exclusions.some((exclusion) => {
    switch (exclusion.type) {
      case "exact":
        return name === exclusion.value;
      case "prefix":
        return name.startsWith(exclusion.value);
      case "suffix":
        return name.endsWith(exclusion.value);
      case "contains":
        return name.includes(exclusion.value);
      case "range":
        return value >= exclusion.from && value <= exclusion.to;
      case "regex":
        return matchesSafeRegex(exclusion.expression, name);
    }
  });
}

function normalizeReset(value: NamingSeriesReset): NamingSeriesReset {
  if (value !== "never" && value !== "year" && value !== "month" && value !== "day") {
    invalidNaming(`Naming reset '${String(value)}' is invalid`);
  }
  return value;
}

function uniqueStrings(values: readonly string[], label: string, maxLength: number): readonly string[] {
  const normalized = values.map((value) => requiredText(value, label, maxLength));
  if (new Set(normalized).size !== normalized.length) {
    invalidNaming(`${label} values must be unique`);
  }
  return normalized;
}

function optionalText<TKey extends string>(
  value: string | undefined,
  label: string,
  maxLength: number,
  key: TKey
): { readonly [K in TKey]?: string } {
  return value === undefined ? {} : { [key]: requiredText(value, label, maxLength) } as { readonly [K in TKey]: string };
}

function requiredText(value: string, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength || hasUnsafeControlCharacter(value)) {
    invalidNaming(`${label} must contain 1-${String(maxLength)} safe characters`);
  }
  return value;
}

function optionalInteger<TKey extends string>(
  value: number | undefined,
  label: string,
  min: number,
  max: number,
  key: TKey
): { readonly [K in TKey]?: number } {
  if (value === undefined) {
    return {};
  }
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    invalidNaming(`${label} must be an integer between ${String(min)} and ${String(max)}`);
  }
  return { [key]: value } as { readonly [K in TKey]: number };
}

function safeAdd(value: number, increment: number): number {
  const result = value + increment;
  if (!Number.isSafeInteger(result)) {
    invalidNaming("Naming sequence exhausted the safe integer range", 409);
  }
  return result;
}

function hasUnsafeControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function invalidNaming(message: string, status = 400): never {
  throw new FrameworkError("NAMING_INVALID", message, { status });
}
