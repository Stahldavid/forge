export type ArtifactKind = "json" | "typescript" | "markdown" | "text";

export function detectArtifactKind(path: string): ArtifactKind {
  if (path.endsWith(".json")) {
    return "json";
  }
  if (path.endsWith(".ts") || path.endsWith(".tsx")) {
    return "typescript";
  }
  if (path.endsWith(".md")) {
    return "markdown";
  }
  return "text";
}
