import ts from "typescript";
import type { JsDoc } from "../types/package-graph.ts";

function tagText(tag: ts.JSDocTag): string {
  if (typeof tag.comment === "string") {
    return tag.comment.trim();
  }
  if (tag.comment) {
    return tag.comment
      .map((part) => part.text)
      .join("")
      .trim();
  }
  return "";
}

export function extractJsDoc(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
): JsDoc | null {
  const parts = symbol.getDocumentationComment(checker);
  const summary = ts.displayPartsToString(parts).trim();

  const tags: { tag: string; text: string }[] = [];
  for (const decl of symbol.declarations ?? []) {
    for (const tag of ts.getJSDocTags(decl)) {
      tags.push({
        tag: tag.tagName.text,
        text: tagText(tag),
      });
    }
  }

  if (summary.length === 0 && tags.length === 0) {
    return null;
  }

  tags.sort((a, b) => {
    const tagCmp = a.tag.localeCompare(b.tag);
    if (tagCmp !== 0) return tagCmp;
    return a.text.localeCompare(b.text);
  });

  return { summary, tags };
}

export function extractExamples(jsdoc: JsDoc | null): string[] {
  if (jsdoc == null) {
    return [];
  }

  const examples = jsdoc.tags
    .filter((tag) => tag.tag.toLowerCase() === "example")
    .map((tag) => normalizeExample(tag.text))
    .filter((text) => text.length > 0);

  return [...new Set(examples)].sort((a, b) => a.localeCompare(b));
}

function normalizeExample(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}
