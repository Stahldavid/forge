export type RuntimeExportKind =
  | "function"
  | "class"
  | "const"
  | "object"
  | "unknown";

export interface RuntimeExportEntry {
  name: string;
  kind: RuntimeExportKind;
}

export interface RuntimeEntrypointShape {
  subpath: string;
  exports: RuntimeExportEntry[];
}

export interface RuntimeExportShape {
  entrypoints: RuntimeEntrypointShape[];
}

export function emptyRuntimeExportShape(): RuntimeExportShape {
  return { entrypoints: [] };
}
