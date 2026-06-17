import type { EmitFile } from "../types/emit.ts";
import {
  hashStable,
  prependDeterministicHeader,
  normalizeNewlines,
  serializeCanonical,
} from "../primitives/index.ts";
import { detectArtifactKind } from "./artifact-kind.ts";

export interface RenderContext {
  generatorVersion: string;
  inputHash: string;
}

function renderJsonBody(content: string): string {
  try {
    const parsed: unknown = JSON.parse(content);
    return serializeCanonical(parsed);
  } catch {
    return normalizeNewlines(content);
  }
}

function renderTypeScriptBody(content: string): string {
  return normalizeNewlines(content);
}

function renderMarkdownBody(content: string): string {
  return normalizeNewlines(content);
}

function renderTextBody(content: string): string {
  return normalizeNewlines(content);
}

/**
 * Normalize file body bytes by artifact kind (no deterministic header).
 */
export function renderBody(file: EmitFile): string {
  const kind = detectArtifactKind(file.path);

  switch (kind) {
    case "json":
      if (file.canonical) {
        return normalizeNewlines(file.content);
      }
      return renderJsonBody(file.content);
    case "typescript":
      return renderTypeScriptBody(file.content);
    case "markdown":
      return renderMarkdownBody(file.content);
    default:
      return renderTextBody(file.content);
  }
}

/**
 * Pure render: same EmitFile + context → same bytes (header included).
 */
export function render(file: EmitFile, context: RenderContext): string {
  const body = renderBody(file);
  const kind = detectArtifactKind(file.path);

  if (file.contentHash !== hashStable(body)) {
    throw new Error(
      `EmitFile contentHash mismatch for ${file.path}: expected ${hashStable(body)}, got ${file.contentHash}`,
    );
  }

  if (kind === "json") {
    return body;
  }

  return prependDeterministicHeader(body, {
    generatorVersion: context.generatorVersion,
    inputHash: context.inputHash,
  });
}
