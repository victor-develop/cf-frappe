import type { JsonValue } from "./types.js";

export interface JsonValueGuardOptions {
  readonly maxDepth?: number;
}

export function isJsonValue(value: unknown, options: JsonValueGuardOptions = {}): value is JsonValue {
  return isJsonValueAtDepth(value, options, 0, new Set<object>());
}

export function cloneJsonValue(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]));
}

function isJsonValueAtDepth(
  value: unknown,
  options: JsonValueGuardOptions,
  depth: number,
  ancestors: Set<object>
): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (options.maxDepth !== undefined && depth > options.maxDepth) {
    return false;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return false;
    }
    ancestors.add(value);
    let valid = true;
    for (let index = 0; index < value.length; index += 1) {
      if (
        !Object.prototype.hasOwnProperty.call(value, index) ||
        !isJsonValueAtDepth(value[index], options, depth + 1, ancestors)
      ) {
        valid = false;
        break;
      }
    }
    ancestors.delete(value);
    return valid;
  }
  if (!isPlainJsonObject(value)) {
    return false;
  }
  if (ancestors.has(value)) {
    return false;
  }
  ancestors.add(value);
  const valid = Object.values(value).every((item) =>
    item !== undefined && isJsonValueAtDepth(item, options, depth + 1, ancestors)
  );
  ancestors.delete(value);
  return valid;
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
