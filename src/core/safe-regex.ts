import { FrameworkError } from "./errors.js";

const MAX_PATTERN_LENGTH = 128;
const MAX_EXPANDED_ATOMS = 256;

type SafeRegexAtom =
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "any" }
  | { readonly kind: "digit" | "word" | "space"; readonly negated: boolean }
  | {
      readonly kind: "class";
      readonly negated: boolean;
      readonly singles: readonly string[];
      readonly ranges: readonly { readonly from: string; readonly to: string }[];
    };

type SafeRegexStep =
  | { readonly kind: "required"; readonly atom: SafeRegexAtom }
  | { readonly kind: "optional"; readonly atom: SafeRegexAtom }
  | { readonly kind: "star"; readonly atom: SafeRegexAtom };

export interface SafeRegex {
  readonly anchoredStart: boolean;
  readonly anchoredEnd: boolean;
  readonly ignoreCase: boolean;
  readonly steps: readonly SafeRegexStep[];
}

export function compileSafeRegex(pattern: string, flags?: "i"): SafeRegex {
  if (
    typeof pattern !== "string" ||
    pattern.length === 0 ||
    pattern.length > MAX_PATTERN_LENGTH ||
    hasUnsafeControlCharacter(pattern)
  ) {
    invalidRegex(`Safe regex patterns must contain 1-${String(MAX_PATTERN_LENGTH)} safe characters`);
  }
  if (flags !== undefined && flags !== "i") {
    invalidRegex("Safe regex flags may only be 'i'");
  }

  const anchoredStart = pattern.startsWith("^");
  let index = anchoredStart ? 1 : 0;
  const steps: SafeRegexStep[] = [];
  let atomCount = 0;
  let anchoredEnd = false;
  while (index < pattern.length) {
    if (pattern[index] === "$" && index === pattern.length - 1) {
      anchoredEnd = true;
      index += 1;
      break;
    }
    const parsed = parseAtom(pattern, index);
    atomCount += 1;
    index = parsed.next;
    const quantified = parseQuantifier(pattern, index);
    index = quantified.next;
    appendQuantifiedSteps(steps, parsed.atom, quantified.min, quantified.max);
    if (steps.length > MAX_EXPANDED_ATOMS) {
      invalidRegex(`Safe regex patterns cannot expand beyond ${String(MAX_EXPANDED_ATOMS)} atoms`);
    }
  }
  if (atomCount === 0) {
    invalidRegex("Safe regex patterns must contain at least one match atom");
  }
  return Object.freeze({
    anchoredStart,
    anchoredEnd,
    ignoreCase: flags === "i",
    steps: Object.freeze(steps)
  });
}

export function matchesSafeRegex(expression: SafeRegex, value: string): boolean {
  let previous = Array.from({ length: value.length + 1 }, (_unused, index) =>
    expression.anchoredStart ? index === 0 : true
  );
  for (const step of expression.steps) {
    const current = Array.from({ length: value.length + 1 }, () => false);
    if (step.kind === "star" || step.kind === "optional") {
      current[0] = previous[0]!;
    }
    for (let index = 1; index <= value.length; index += 1) {
      const matched = atomMatches(step.atom, value[index - 1]!, expression.ignoreCase);
      if (step.kind === "required") {
        current[index] = previous[index - 1]! && matched;
      } else if (step.kind === "optional") {
        current[index] = previous[index]! || (previous[index - 1]! && matched);
      } else {
        current[index] = previous[index]! || (current[index - 1]! && matched);
      }
    }
    previous = current;
  }
  return expression.anchoredEnd ? previous[value.length]! : previous.some(Boolean);
}

function parseAtom(pattern: string, index: number): { readonly atom: SafeRegexAtom; readonly next: number } {
  const character = pattern[index]!;
  if (
    character === "^" ||
    character === "$" ||
    character === "(" ||
    character === ")" ||
    character === "|" ||
    isQuantifierStart(character)
  ) {
    invalidRegex(`Unexpected safe regex operator '${character}' at position ${String(index)}`);
  }
  if (character === ".") {
    return { atom: Object.freeze({ kind: "any" }), next: index + 1 };
  }
  if (character === "[") {
    return parseCharacterClass(pattern, index);
  }
  if (character === "\\") {
    return parseEscape(pattern, index);
  }
  return { atom: Object.freeze({ kind: "literal", value: character }), next: index + 1 };
}

function parseEscape(pattern: string, index: number): { readonly atom: SafeRegexAtom; readonly next: number } {
  const escaped = pattern[index + 1];
  if (escaped === undefined) {
    invalidRegex("Safe regex patterns cannot end with an escape character");
  }
  const shorthand = shorthandAtom(escaped);
  return shorthand === undefined
    ? { atom: Object.freeze({ kind: "literal", value: escaped }), next: index + 2 }
    : { atom: shorthand, next: index + 2 };
}

function shorthandAtom(character: string): SafeRegexAtom | undefined {
  const lower = character.toLowerCase();
  if (lower !== "d" && lower !== "w" && lower !== "s") {
    return undefined;
  }
  return Object.freeze({
    kind: lower === "d" ? "digit" : lower === "w" ? "word" : "space",
    negated: character !== lower
  });
}

function parseCharacterClass(
  pattern: string,
  start: number
): { readonly atom: SafeRegexAtom; readonly next: number } {
  let index = start + 1;
  const negated = pattern[index] === "^";
  if (negated) {
    index += 1;
  }
  const values: { readonly value: string; readonly escaped: boolean }[] = [];
  while (index < pattern.length && pattern[index] !== "]") {
    if (pattern[index] === "\\") {
      const escaped = pattern[index + 1];
      if (escaped === undefined || shorthandAtom(escaped) !== undefined) {
        invalidRegex("Safe regex character classes only support escaped literal characters");
      }
      values.push(Object.freeze({ value: escaped, escaped: true }));
      index += 2;
    } else {
      values.push(Object.freeze({ value: pattern[index]!, escaped: false }));
      index += 1;
    }
  }
  if (pattern[index] !== "]" || values.length === 0) {
    invalidRegex("Safe regex character classes must be non-empty and closed");
  }

  const singles: string[] = [];
  const ranges: { readonly from: string; readonly to: string }[] = [];
  for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
    if (
      valueIndex + 2 < values.length &&
      values[valueIndex + 1]!.value === "-" &&
      !values[valueIndex + 1]!.escaped &&
      values[valueIndex]!.value !== "-" &&
      values[valueIndex + 2]!.value !== "-"
    ) {
      const from = values[valueIndex]!.value;
      const to = values[valueIndex + 2]!.value;
      if (from.codePointAt(0)! > to.codePointAt(0)!) {
        invalidRegex(`Safe regex character class range '${from}-${to}' is reversed`);
      }
      ranges.push(Object.freeze({ from, to }));
      valueIndex += 2;
    } else {
      singles.push(values[valueIndex]!.value);
    }
  }
  return {
    atom: Object.freeze({
      kind: "class",
      negated,
      singles: Object.freeze(singles),
      ranges: Object.freeze(ranges)
    }),
    next: index + 1
  };
}

function parseQuantifier(
  pattern: string,
  index: number
): { readonly min: number; readonly max: number | null; readonly next: number } {
  const character = pattern[index];
  if (character === undefined || character === "$" || !isQuantifierStart(character)) {
    return { min: 1, max: 1, next: index };
  }
  if (character === "?") {
    return { min: 0, max: 1, next: index + 1 };
  }
  if (character === "*") {
    return { min: 0, max: null, next: index + 1 };
  }
  if (character === "+") {
    return { min: 1, max: null, next: index + 1 };
  }

  const end = pattern.indexOf("}", index + 1);
  if (end < 0) {
    invalidRegex("Safe regex quantifiers must be closed");
  }
  const parts = pattern.slice(index + 1, end).split(",");
  if (parts.length > 2 || parts[0] === "" || !isDecimal(parts[0]!)) {
    invalidRegex("Safe regex quantifiers must use '{n}', '{n,m}', or '{n,}'");
  }
  const min = Number(parts[0]);
  const max = parts.length === 1 ? min : parts[1] === "" ? null : decimalNumber(parts[1]!);
  if (min > MAX_EXPANDED_ATOMS || (max !== null && (max < min || max > MAX_EXPANDED_ATOMS))) {
    invalidRegex(`Safe regex quantifiers must stay within ${String(MAX_EXPANDED_ATOMS)} atoms`);
  }
  return { min, max, next: end + 1 };
}

function appendQuantifiedSteps(
  steps: SafeRegexStep[],
  atom: SafeRegexAtom,
  min: number,
  max: number | null
): void {
  for (let index = 0; index < min; index += 1) {
    steps.push(Object.freeze({ kind: "required", atom }));
  }
  if (max === null) {
    steps.push(Object.freeze({ kind: "star", atom }));
    return;
  }
  for (let index = min; index < max; index += 1) {
    steps.push(Object.freeze({ kind: "optional", atom }));
  }
}

function atomMatches(atom: SafeRegexAtom, value: string, ignoreCase: boolean): boolean {
  if (atom.kind === "any") {
    return true;
  }
  if (atom.kind === "literal") {
    return comparable(atom.value, ignoreCase) === comparable(value, ignoreCase);
  }
  if (atom.kind !== "class") {
    const matched = atom.kind === "digit"
      ? value >= "0" && value <= "9"
      : atom.kind === "word"
        ? isAsciiWord(value)
        : value === " " || value === "\t";
    return atom.negated ? !matched : matched;
  }
  const candidate = comparable(value, ignoreCase);
  const matched = atom.singles.some((single) => comparable(single, ignoreCase) === candidate) ||
    atom.ranges.some((range) => {
      const from = comparable(range.from, ignoreCase);
      const to = comparable(range.to, ignoreCase);
      return candidate >= from && candidate <= to;
    });
  return atom.negated ? !matched : matched;
}

function comparable(value: string, ignoreCase: boolean): string {
  return ignoreCase ? value.toLocaleLowerCase("en-US") : value;
}

function isAsciiWord(value: string): boolean {
  return (value >= "a" && value <= "z") ||
    (value >= "A" && value <= "Z") ||
    (value >= "0" && value <= "9") ||
    value === "_";
}

function isQuantifierStart(value: string): boolean {
  return value === "?" || value === "*" || value === "+" || value === "{";
}

function isDecimal(value: string): boolean {
  return value.length > 0 && [...value].every((character) => character >= "0" && character <= "9");
}

function decimalNumber(value: string): number {
  if (!isDecimal(value)) {
    invalidRegex("Safe regex quantifiers must contain decimal integers");
  }
  return Number(value);
}

function hasUnsafeControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0)!;
    return code <= 0x1f || code === 0x7f;
  });
}

function invalidRegex(message: string): never {
  throw new FrameworkError("NAMING_INVALID", message, { status: 400 });
}
