import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import type { SyntaxNode } from "tree-sitter";
import type { DataField } from "../types/data-graph.ts";

const tsParser = new Parser();
tsParser.setLanguage(TypeScript.typescript as unknown as Parser.Language);

export interface ParsedDefineTable {
  tableName: string | null;
  fields: DataField[];
}

function unwrapStringLiteral(node: SyntaxNode): string | null {
  if (node.type === "string") {
    const text = node.text;
    if (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))
    ) {
      return text.slice(1, -1);
    }
    return text;
  }

  if (node.type === "template_string") {
    const fragments = node.namedChildren.filter(
      (child) => child.type === "string_fragment",
    );
    if (fragments.length === 1 && node.namedChildren.length === 1) {
      return fragments[0]?.text ?? null;
    }
    return null;
  }

  return null;
}

function extractFieldsFromObject(objectNode: SyntaxNode): DataField[] {
  const fields: DataField[] = [];

  for (const child of objectNode.namedChildren) {
    if (child.type !== "pair") {
      continue;
    }

    const keyNode = child.childForFieldName("key");
    const valueNode = child.childForFieldName("value");
    if (!keyNode || !valueNode) {
      continue;
    }

    const key =
      keyNode.type === "property_identifier" || keyNode.type === "identifier"
        ? keyNode.text
        : unwrapStringLiteral(keyNode);

    if (!key || key === "name") {
      continue;
    }

    const typeValue = unwrapStringLiteral(valueNode);
    if (typeValue !== null) {
      fields.push({ name: key, type: typeValue });
    }
  }

  return fields.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function extractNameFromObject(objectNode: SyntaxNode): string | null {
  for (const child of objectNode.namedChildren) {
    if (child.type !== "pair") {
      continue;
    }

    const keyNode = child.childForFieldName("key");
    const valueNode = child.childForFieldName("value");
    if (!keyNode || !valueNode) {
      continue;
    }

    const key =
      keyNode.type === "property_identifier" || keyNode.type === "identifier"
        ? keyNode.text
        : unwrapStringLiteral(keyNode);

    if (key === "name") {
      return unwrapStringLiteral(valueNode);
    }
  }

  return null;
}

function parseCallArguments(callNode: SyntaxNode): ParsedDefineTable | null {
  const argsNode = callNode.childForFieldName("arguments");
  if (!argsNode) {
    return { tableName: null, fields: [] };
  }

  const args = argsNode.namedChildren.filter(
    (child) =>
      child.type !== "," &&
      child.type !== "comment" &&
      child.type !== "(" &&
      child.type !== ")",
  );

  if (args.length === 0) {
    return { tableName: null, fields: [] };
  }

  const first = args[0];
  if (!first) {
    return { tableName: null, fields: [] };
  }

  if (first.type === "string" || first.type === "template_string") {
    const tableName = unwrapStringLiteral(first);
    const second = args[1];
    const fields =
      second?.type === "object" ? extractFieldsFromObject(second) : [];
    return { tableName, fields };
  }

  if (first.type === "object") {
    const tableName = extractNameFromObject(first);
    const fields = extractFieldsFromObject(first);
    return { tableName, fields };
  }

  return null;
}

function findDefineTableCall(root: SyntaxNode): SyntaxNode | null {
  if (root.type === "call_expression") {
    const functionNode = root.childForFieldName("function");
    if (functionNode?.type === "identifier" && functionNode.text === "defineTable") {
      return root;
    }
  }

  for (const child of root.namedChildren) {
    const found = findDefineTableCall(child);
    if (found) {
      return found;
    }
  }

  return null;
}

/**
 * Parse a defineTable call slice extracted by AppGraph.
 */
export function parseDefineTableSlice(sourceSlice: string): ParsedDefineTable | null {
  const trimmed = sourceSlice.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const wrapped = `(${trimmed})`;
  const tree = tsParser.parse(wrapped);
  const callNode = findDefineTableCall(tree.rootNode);
  if (!callNode) {
    return null;
  }

  return parseCallArguments(callNode);
}
