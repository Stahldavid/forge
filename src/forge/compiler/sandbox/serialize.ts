import type {
  RuntimeEntrypointShape,
  RuntimeExportEntry,
  RuntimeExportKind,
  RuntimeExportShape,
} from "./types.ts";

export function serializeRuntimeExportShape(shape: RuntimeExportShape): string {
  return JSON.stringify(shape);
}

export function parseRuntimeExportShape(raw: string): RuntimeExportShape {
  const parsed: unknown = JSON.parse(raw);
  return sanitizeRuntimeExportShape(parsed);
}

function parseExportKind(value: unknown): RuntimeExportKind {
  if (
    value === "function" ||
    value === "class" ||
    value === "const" ||
    value === "object"
  ) {
    return value;
  }
  return "unknown";
}

export function sanitizeRuntimeExportShape(value: unknown): RuntimeExportShape {
  if (typeof value !== "object" || value === null) {
    return { entrypoints: [] };
  }

  const record = value as Record<string, unknown>;
  const entrypointsRaw = Array.isArray(record.entrypoints)
    ? record.entrypoints
    : [];

  const entrypoints: RuntimeEntrypointShape[] = [];

  for (const item of entrypointsRaw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const ep = item as Record<string, unknown>;
    const subpath = typeof ep.subpath === "string" ? ep.subpath : ".";
    const exportsRaw = Array.isArray(ep.exports) ? ep.exports : [];
    const exports: RuntimeExportEntry[] = [];

    for (const entry of exportsRaw) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const ex = entry as Record<string, unknown>;
      if (typeof ex.name !== "string") {
        continue;
      }
      exports.push({
        name: ex.name,
        kind: parseExportKind(ex.kind),
      });
    }

    exports.sort((a, b) => a.name.localeCompare(b.name));
    entrypoints.push({ subpath, exports });
  }

  entrypoints.sort((a, b) => a.subpath.localeCompare(b.subpath));
  return { entrypoints };
}

export function assertJsonSerializable(value: unknown): void {
  const seen = new WeakSet<object>();

  const walk = (current: unknown): void => {
    if (current == null || typeof current !== "object") {
      if (
        typeof current === "function" ||
        typeof current === "symbol" ||
        typeof current === "bigint"
      ) {
        throw new Error("non-JSON-serializable sandbox value");
      }
      return;
    }

    if (seen.has(current)) {
      return;
    }
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        walk(item);
      }
      return;
    }

    for (const key of Object.keys(current)) {
      walk((current as Record<string, unknown>)[key]);
    }
  };

  walk(value);
  JSON.stringify(value);
}
