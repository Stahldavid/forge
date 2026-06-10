import { comparePaths, normalizeNewlines, normalizePath } from "../primitives/index.ts";
import { BARREL_INDEX_PATH, GENERATED_DIR } from "./constants.ts";

function toBarrelExportPath(filePath: string): string {
  const normalized = normalizePath(filePath);
  const generatedPrefix = `${GENERATED_DIR}/`;

  if (!normalized.startsWith(generatedPrefix)) {
    throw new Error(`barrel export path must live under ${GENERATED_DIR}: ${filePath}`);
  }

  const relative = normalized.slice(generatedPrefix.length);
  const withoutExtension = relative.replace(/\.tsx?$/, "");
  return `./${withoutExtension}`;
}

/**
 * Build barrel index.ts body (sorted re-exports, no header).
 */
export function buildBarrelIndexBody(exportFilePaths: string[]): string {
  const candidates = exportFilePaths
    .map(normalizePath)
    .filter(
      (path) =>
        path.startsWith(`${GENERATED_DIR}/`) &&
        (path.endsWith(".ts") || path.endsWith(".tsx")) &&
        !path.endsWith(".d.ts") &&
        path !== BARREL_INDEX_PATH,
    );

  const unique = [...new Set(candidates)];
  unique.sort(comparePaths);

  const lines = unique.map((path) => {
    const exportPath = toBarrelExportPath(path);
    return `export * from "${exportPath}";`;
  });

  if (lines.length === 0) {
    return normalizeNewlines("// Forge generated barrel\n");
  }

  return normalizeNewlines(lines.join("\n"));
}
