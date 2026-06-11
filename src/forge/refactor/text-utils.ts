/**
 * Pure string helpers for the refactor engine.
 *
 * Extracted from the former `refactor/index.ts` god file. These functions have
 * no I/O and no domain dependencies, which makes them trivially testable.
 */

/** Escape a string for safe interpolation into a `RegExp`. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace whole-word occurrences of `from` with `to`. */
export function wordReplace(content: string, from: string, to: string): string {
  return content.replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, "g"), to);
}

/** Push `value` onto `values` only if it is not already present. */
export function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

/** Parse a `table.field` selector into its parts, or `null` when malformed. */
export function parseTableField(
  value: string | undefined,
): { table: string; field: string } | null {
  const [table, field] = (value ?? "").split(".");
  if (!table || !field) {
    return null;
  }
  return { table, field };
}
