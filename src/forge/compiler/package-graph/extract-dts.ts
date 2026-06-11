import type { ExportSignature } from "../types/package-graph.ts";
import { compareExports } from "../primitives/sort.ts";
import { readTextFile } from "./read-file.ts";
import type { ResolutionMode } from "../types/runtime.ts";
import {
  DtsSignatureExtractor,
  normalizeSignatureText,
} from "./dts-extractor.ts";

export { normalizeSignatureText };

export function extractDtsSignatures(
  dtsPath: string,
  packageName: string,
  entrypoint: string,
  mode: ResolutionMode,
): ExportSignature[] {
  const extractor = new DtsSignatureExtractor(mode);
  return extractor.extract(dtsPath, packageName, entrypoint);
}

export function canParseDtsFile(dtsPath: string, mode: ResolutionMode): boolean {
  try {
    readTextFile(dtsPath);
    const exports = extractDtsSignatures(dtsPath, "probe", ".", mode);
    return exports.length >= 0;
  } catch {
    return false;
  }
}

export { compareExports, DtsSignatureExtractor };
