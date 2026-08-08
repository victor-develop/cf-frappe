import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Security audit for the JSX escape hatch.
 *
 * JSX escapes text and attribute interpolations by default; `UnsafeRawHtml`
 * is the single sanctioned bypass. Every use must be intentional, carry a
 * meaningful `reason`, and stay on this allowlist. If you add or remove a
 * use, update the allowlist below and justify it in review — do not reach
 * for `UnsafeRawHtml` for convenience.
 */

const VIEWS_DIR = join(__dirname, "..", "..", "src", "adapters", "desk", "views");

/** Expected `<UnsafeRawHtml` occurrences per view module. */
const ALLOWLIST: Record<string, number> = {
  // Pre-escaped form controls from the shared meta-controls string renderers
  // (user selector, role multi-selector, doctype/field selects, datalists).
  "admin-access.tsx": 6,
  "admin-rules.tsx": 6,
  "admin-metadata.tsx": 1,
  // Document-reference picker controls from meta-controls (escaped internally).
  "files.tsx": 4,
  // Pre-built SVG chart bodies and client runtime script tags from shared.ts.
  "dashboards.tsx": 1,
  "reports.tsx": 2,
  // Client runtime script tags (form view) plus the compound filter builder,
  // whose bare data-cf-frappe-* attributes are asserted byte-for-byte by
  // desk-app tests and cannot be serialized by hono/jsx.
  "formview.tsx": 1,
  "listview.tsx": 2,
  // Presence panel skeleton: constant markup preserving bare valueless
  // data-cf-frappe-*/hidden attributes asserted byte-for-byte.
  "inbox.tsx": 1,
  // Document shell: non-self-closing stylesheet <link> (byte-asserted) and
  // the pre-rendered page body slot (the intended legitimate use).
  "shell.tsx": 2,
  // Print preview bodies are sanitized upstream; printing view needs no raw.
  "printing.tsx": 0,
  "boards.tsx": 0,
  "admin-jobs.tsx": 0
};

function viewFiles(): string[] {
  return readdirSync(VIEWS_DIR).filter((name) => name.endsWith(".tsx"));
}

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let index = source.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = source.indexOf(needle, index + needle.length);
  }
  return count;
}

describe("UnsafeRawHtml audit (desk views)", () => {
  it("keeps every view module on the allowlist", () => {
    for (const file of viewFiles()) {
      expect(ALLOWLIST, `unlisted view module ${file}; add it to the audit allowlist`).toHaveProperty(file);
    }
  });

  it("matches the allowlisted UnsafeRawHtml count per view module", () => {
    const counts: Record<string, number> = {};
    for (const file of viewFiles()) {
      const source = readFileSync(join(VIEWS_DIR, file), "utf8");
      counts[file] = countOccurrences(source, "<UnsafeRawHtml");
    }
    expect(counts).toEqual(ALLOWLIST);
  });

  it("gives every UnsafeRawHtml use a meaningful reason", () => {
    for (const file of viewFiles()) {
      const source = readFileSync(join(VIEWS_DIR, file), "utf8");
      let index = source.indexOf("<UnsafeRawHtml");
      while (index !== -1) {
        // Inspect the attribute region following the opening tag. The window
        // is generous because reasons may span several wrapped lines.
        const element = source.slice(index, index + 1000);
        const literal = /reason="([^"]*)"/.exec(element) ?? /reason=\{`([^`]*)`\}/.exec(element);
        if (literal !== null) {
          expect(
            literal[1]!.trim().length,
            `${file}: UnsafeRawHtml reason must explain why raw HTML is required`
          ).toBeGreaterThanOrEqual(20);
        } else {
          // reason={SOME_CONST}: resolve the identifier to its string literal.
          const identifier = /reason=\{([A-Za-z_$][\w$]*)\}/.exec(element);
          expect(identifier, `${file}: UnsafeRawHtml must set a reason attribute`).not.toBeNull();
          const constPattern = new RegExp(`const ${identifier![1]!} =\\s*\\n?\\s*"([^"]+)"`);
          const constMatch = constPattern.exec(source);
          expect(constMatch, `${file}: reason constant ${identifier![1]!} must be a string literal`).not.toBeNull();
          expect(
            constMatch![1]!.trim().length,
            `${file}: UnsafeRawHtml reason must explain why raw HTML is required`
          ).toBeGreaterThanOrEqual(20);
        }
        index = source.indexOf("<UnsafeRawHtml", index + "<UnsafeRawHtml".length);
      }
    }
  });

  it("does not use escapeHtml in converted view modules", () => {
    for (const file of viewFiles()) {
      const source = readFileSync(join(VIEWS_DIR, file), "utf8");
      expect(
        source.includes("escapeHtml("),
        `${file}: JSX escapes by default; escapeHtml must not reappear in converted views`
      ).toBe(false);
    }
  });
});
