import type { RepositoryNode } from "./types.ts";

export function compactRepositoryMetadata(metadata: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const compact: Record<string, unknown> = {};
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.length <= 512 || typeof value === "boolean" || typeof value === "number") compact[key] = value;
    else if (value !== undefined) compact.metadataOmitted = true;
  }
  return compact;
}
export function compactRepositoryContextNode(node: RepositoryNode, access: "write-scope" | "read-only", selectionReasons: string[]) {
  return { id: node.id, kind: node.kind, name: node.name.slice(0, 256), file: node.file, component: node.component,
    location: node.location, evidence: node.evidence,
    metadata: compactRepositoryMetadata(node.metadata, ["qualifiedName", "handler", "symbolKind", "javaClass", "method", "path", "requestPathPattern", "clientId", "clientConfidence", "baseKnown", "owner", "qualifier", "signature", "framework"]),
    access, selectionReasons };
}
