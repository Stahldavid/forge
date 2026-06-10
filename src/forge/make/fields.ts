import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { MakeFieldSpec, MakeFieldType } from "./types.ts";

const FIELD_TYPES = new Set<MakeFieldType>([
  "uuid",
  "text",
  "number",
  "integer",
  "boolean",
  "timestamp",
  "json",
  "enum",
  "ref",
]);

export function splitTopLevel(value: string, separator = ","): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of value) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    }
    if (char === separator && depth === 0) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

function parseType(raw: string): {
  type: MakeFieldType | null;
  enumValues?: string[];
  refTable?: string;
} {
  const enumMatch = raw.match(/^enum\((.*)\)$/);
  if (enumMatch) {
    return {
      type: "enum",
      enumValues: splitTopLevel(enumMatch[1] ?? "").map((part) => part.trim()),
    };
  }
  const refMatch = raw.match(/^ref\((.*)\)$/);
  if (refMatch) {
    return { type: "ref", refTable: refMatch[1]?.trim() };
  }
  return FIELD_TYPES.has(raw as MakeFieldType)
    ? { type: raw as MakeFieldType }
    : { type: null };
}

export function parseFieldSpec(raw: string): {
  field?: MakeFieldSpec;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const [nameRaw, typeRaw, ...flags] = raw.split(":").map((part) => part.trim());
  const parsedType = parseType(typeRaw ?? "");

  if (!nameRaw || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(nameRaw)) {
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: "FORGE_MAKE_FIELD_INVALID",
        message: `invalid field name in '${raw}'`,
      }),
    );
  }

  if (!parsedType.type) {
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: "FORGE_MAKE_FIELD_INVALID",
        message: `unsupported field type in '${raw}'`,
      }),
    );
  }

  if (diagnostics.length > 0 || !nameRaw || !parsedType.type) {
    return { diagnostics };
  }

  const field: MakeFieldSpec = {
    name: nameRaw,
    type: parsedType.type,
    required: flags.includes("required"),
    optional: flags.includes("optional"),
    ...(parsedType.enumValues ? { enumValues: parsedType.enumValues } : {}),
    ...(parsedType.refTable ? { refTable: parsedType.refTable } : {}),
  };

  for (const flag of flags) {
    if (flag.startsWith("default=")) {
      field.default = flag.slice("default=".length);
    }
    if (flag === "defaultNow") {
      field.defaultNow = true;
    }
    if (flag === "unique") {
      field.unique = true;
    }
    if (flag === "index") {
      field.indexed = true;
    }
  }

  return { field, diagnostics };
}

export function parseFields(rawFields: string[]): {
  fields: MakeFieldSpec[];
  diagnostics: Diagnostic[];
} {
  const fields: MakeFieldSpec[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const raw of rawFields.flatMap((value) => splitTopLevel(value))) {
    const parsed = parseFieldSpec(raw);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.field) {
      fields.push(parsed.field);
    }
  }
  return { fields, diagnostics };
}

export function fieldTypeForSchema(field: MakeFieldSpec): string {
  if (field.type === "enum") {
    return `enum:${field.enumValues?.join(",") ?? ""}`;
  }
  if (field.type === "ref") {
    return `ref:${field.refTable ?? field.name.replace(/Id$/, "s")}`;
  }
  return field.type;
}
